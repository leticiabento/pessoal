<?php
// Modelo da configuração. No servidor, o api/config.php é gerado pelo deploy
// a partir dos secrets do GitHub; este arquivo serve só como referência.
return [
    'db_host' => 'localhost',
    'db_name' => 'usuario_financas',
    'db_user' => 'usuario_financas',
    'db_pass' => 'senha-do-banco',
    // Gere com: php -r 'echo password_hash("sua-senha", PASSWORD_DEFAULT);'
    'password_hash' => '$2y$10$...',
];
