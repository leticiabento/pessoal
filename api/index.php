<?php
// API do controle financeiro: login com senha única e armazenamento dos dados no MySQL.
// Rotas: ?action=session | login | logout | state (GET/PUT)

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const COOKIE_NAME = 'pessoal_sess';
const SESSION_DAYS = 30;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MIN = 15;
const MAX_STATE_BYTES = 5 * 1024 * 1024;

function respond(int $status, array $body = []): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function connect(array $c): PDO
{
    $pdo = new PDO(
        "mysql:host={$c['db_host']};dbname={$c['db_name']};charset=utf8mb4",
        $c['db_user'],
        $c['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
    // As tabelas são criadas na primeira chamada, sem passo manual de instalação.
    $pdo->exec('CREATE TABLE IF NOT EXISTS app_state (
        id TINYINT UNSIGNED PRIMARY KEY,
        data LONGTEXT NOT NULL,
        version INT UNSIGNED NOT NULL,
        updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    $pdo->exec('CREATE TABLE IF NOT EXISTS sessions (
        token_hash CHAR(64) PRIMARY KEY,
        expires_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    $pdo->exec('CREATE TABLE IF NOT EXISTS login_attempts (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        ip VARCHAR(45) NOT NULL,
        attempted_at DATETIME NOT NULL,
        INDEX idx_ip_time (ip, attempted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    return $pdo;
}

function readJson(): array
{
    $body = json_decode((string) file_get_contents('php://input'), true);
    return is_array($body) ? $body : [];
}

function cookiePath(): string
{
    // api/index.php fica um nível abaixo da pasta do app.
    $dir = rtrim(str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/'))), '/');
    return $dir . '/';
}

function isHttps(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function sendCookie(string $value, int $expires): void
{
    setcookie(COOKIE_NAME, $value, [
        'expires' => $expires,
        'path' => cookiePath(),
        'secure' => isHttps(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function currentToken(): ?string
{
    $t = $_COOKIE[COOKIE_NAME] ?? '';
    return is_string($t) && preg_match('/^[a-f0-9]{64}$/', $t) ? $t : null;
}

function isAuthenticated(PDO $pdo): bool
{
    $token = currentToken();
    if ($token === null) {
        return false;
    }
    $st = $pdo->prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > NOW()');
    $st->execute([hash('sha256', $token)]);
    return (bool) $st->fetchColumn();
}

function requireAuth(PDO $pdo): void
{
    if (!isAuthenticated($pdo)) {
        respond(401, ['error' => 'Faça login novamente.']);
    }
}

$configFile = __DIR__ . '/config.php';
if (!is_file($configFile)) {
    respond(500, ['error' => 'Configuração ausente no servidor (api/config.php).']);
}
$config = require $configFile;

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Proteção contra CSRF: navegadores não enviam este cabeçalho em requisições de outros sites.
if ($method !== 'GET' && ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') {
    respond(403, ['error' => 'Requisição inválida.']);
}

try {
    $pdo = connect($config);

    if ($action === 'session' && $method === 'GET') {
        respond(200, ['authenticated' => isAuthenticated($pdo)]);
    }

    if ($action === 'login' && $method === 'POST') {
        $ip = substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
        $st = $pdo->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND attempted_at > DATE_SUB(NOW(), INTERVAL ' . ATTEMPT_WINDOW_MIN . ' MINUTE)');
        $st->execute([$ip]);
        if ((int) $st->fetchColumn() >= MAX_ATTEMPTS) {
            respond(429, ['error' => 'Muitas tentativas. Aguarde ' . ATTEMPT_WINDOW_MIN . ' minutos.']);
        }

        $password = (string) (readJson()['password'] ?? '');
        if ($password === '' || !password_verify($password, $config['password_hash'])) {
            $pdo->prepare('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, NOW())')->execute([$ip]);
            sleep(1);
            respond(401, ['error' => 'Senha incorreta.']);
        }

        $pdo->prepare('DELETE FROM login_attempts WHERE ip = ? OR attempted_at < DATE_SUB(NOW(), INTERVAL 1 DAY)')->execute([$ip]);
        $pdo->exec('DELETE FROM sessions WHERE expires_at <= NOW()');
        $token = bin2hex(random_bytes(32));
        $pdo->prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, DATE_ADD(NOW(), INTERVAL ' . SESSION_DAYS . ' DAY))')
            ->execute([hash('sha256', $token)]);
        sendCookie($token, time() + SESSION_DAYS * 86400);
        respond(200, ['authenticated' => true]);
    }

    if ($action === 'logout' && $method === 'POST') {
        $token = currentToken();
        if ($token !== null) {
            $pdo->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([hash('sha256', $token)]);
        }
        sendCookie('', time() - 3600);
        respond(200, ['authenticated' => false]);
    }

    if ($action === 'state' && $method === 'GET') {
        requireAuth($pdo);
        $row = $pdo->query('SELECT data, version, updated_at FROM app_state WHERE id = 1')->fetch();
        respond(200, $row
            ? ['data' => $row['data'], 'version' => (int) $row['version'], 'updatedAt' => $row['updated_at']]
            : ['data' => null, 'version' => 0]);
    }

    if ($action === 'state' && $method === 'PUT') {
        requireAuth($pdo);
        $body = readJson();
        // Os dados chegam como texto JSON e são guardados sem reconversão,
        // para não transformar objetos vazios em listas.
        $data = $body['data'] ?? null;
        $version = $body['version'] ?? null;
        if (!is_string($data) || !is_int($version) || strlen($data) > MAX_STATE_BYTES) {
            respond(400, ['error' => 'Dados inválidos.']);
        }
        $decoded = json_decode($data);
        if (!is_object($decoded) || !isset($decoded->months) || !is_object($decoded->months)) {
            respond(400, ['error' => 'Formato de dados inválido.']);
        }

        if ($version === 0) {
            try {
                $pdo->prepare('INSERT INTO app_state (id, data, version, updated_at) VALUES (1, ?, 1, NOW())')->execute([$data]);
            } catch (PDOException $e) {
                if ($e->getCode() === '23000') {
                    respond(409, ['error' => 'Os dados foram alterados em outro aparelho.']);
                }
                throw $e;
            }
            respond(200, ['version' => 1]);
        }

        $st = $pdo->prepare('UPDATE app_state SET data = ?, version = version + 1, updated_at = NOW() WHERE id = 1 AND version = ?');
        $st->execute([$data, $version]);
        if ($st->rowCount() === 0) {
            respond(409, ['error' => 'Os dados foram alterados em outro aparelho.']);
        }
        respond(200, ['version' => $version + 1]);
    }

    respond(404, ['error' => 'Rota não encontrada.']);
} catch (PDOException $e) {
    error_log('pessoal api: ' . $e->getMessage());
    respond(500, ['error' => 'Erro ao acessar o banco de dados.']);
}
