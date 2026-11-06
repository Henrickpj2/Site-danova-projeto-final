<?php
/**
 * danova-ai.com — Central de E-mails do CRM: dispara o e-mail pelo servidor de e-mail da Hostinger.
 *
 * O CRM chama a função email-enviar no Supabase (que valida login, permissão, descadastro e duplicidade e
 * guarda o e-mail pronto). Depois o navegador chama este arquivo com o id do envio e a sessão do usuário:
 *   1) pede à função para RESERVAR o envio (só funciona uma vez, só para quem criou, só nos primeiros 10 minutos);
 *   2) envia com mail() a partir de danova-ai@danova-ai.com;
 *   3) informa o resultado à função, que grava no CRM e no histórico do lead.
 * Nenhuma chave secreta fica aqui: a autorização é a própria sessão do usuário no CRM.
 */
const REMETENTE      = 'danova-ai@danova-ai.com';   // caixa existente na Hostinger
const REMETENTE_NOME = 'DANOVA-AI';
const CRM_URL  = 'https://oeylfwasqvbnybzrwtgf.supabase.co';
const CRM_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9leWxmd2FzcXZibnlienJ3dGdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NDkxNDYsImV4cCI6MjEwODEyNTE0Nn0.xfl5HyVe4RGqs0VYNt-a7Rox1Ro9ORQlkdNirxG3FeY';
const ORIGENS  = ['https://danova-ai.com', 'https://www.danova-ai.com'];

header('Content-Type: application/json; charset=utf-8');
header('X-Robots-Tag: noindex');
header('Cache-Control: no-store');
$origem = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origem && in_array($origem, ORIGENS, true)) {
    header('Access-Control-Allow-Origin: ' . $origem);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}
function sair($codigo, $dados) { http_response_code($codigo); echo json_encode($dados, JSON_UNESCAPED_UNICODE); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') sair(405, ['erro' => 'metodo']);
if ($origem && !in_array($origem, ORIGENS, true)) sair(403, ['erro' => 'origem']);

$in = json_decode(file_get_contents('php://input') ?: '', true);
$id = (string)($in['envio_id'] ?? '');
$token = (string)($in['token'] ?? '');
if (!preg_match('/^[0-9a-f-]{36}$/i', $id) || !preg_match('/^[A-Za-z0-9._-]{20,4000}$/', $token)) sair(400, ['erro' => 'dados_invalidos']);

function funcao($token, $corpo) {
    $ch = curl_init(CRM_URL . '/functions/v1/email-enviar');
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'apikey: ' . CRM_ANON, 'Authorization: Bearer ' . $token],
        CURLOPT_POSTFIELDS => json_encode($corpo),
    ]);
    $r = curl_exec($ch); $st = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    return [$st, json_decode($r ?: '', true) ?: []];
}
function cabecalho($t) { return '=?UTF-8?B?' . base64_encode($t) . '?='; }
function limpo($t) { return trim(str_replace(["\r", "\n"], ' ', (string)$t)); }

[$st, $env] = funcao($token, ['acao' => 'hostinger_reservar', 'envio_id' => $id]);
if ($st !== 200 || empty($env['ok'])) sair($st === 401 ? 401 : 409, ['erro' => $env['erro'] ?? 'reserva_falhou']);

$para = limpo($env['para']);
if (!filter_var($para, FILTER_VALIDATE_EMAIL)) {
    funcao($token, ['acao' => 'hostinger_resultado', 'envio_id' => $id, 'ok' => false, 'erro' => 'E-mail do destinatário inválido']);
    sair(400, ['erro' => 'email_invalido']);
}
$responder = filter_var(limpo($env['responder'] ?? ''), FILTER_VALIDATE_EMAIL) ?: REMETENTE;
$html = (string)$env['html'];
$texto = trim(html_entity_decode(strip_tags(preg_replace(['/<(br|\/p|\/li|\/h2|\/h3|\/tr)[^>]*>/i', '/<li[^>]*>/i'], ["\n", "\n• "], $html)), ENT_QUOTES, 'UTF-8'));
$texto = preg_replace("/\n{3,}/", "\n\n", preg_replace("/[ \t]+/", ' ', $texto));
$fronteira = 'dnv-' . bin2hex(random_bytes(12));
$dominio = 'danova-ai.com';

$h  = 'From: ' . cabecalho(REMETENTE_NOME) . ' <' . REMETENTE . ">\r\n";
$h .= 'Reply-To: ' . $responder . "\r\n";
$h .= 'Message-ID: <' . $id . '@' . $dominio . ">\r\n";
$h .= 'List-Unsubscribe: <' . limpo($env['descadastro']) . ">, <mailto:" . REMETENTE . "?subject=Descadastro>\r\n";
$h .= "List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n";
$h .= "MIME-Version: 1.0\r\n";
$h .= 'Content-Type: multipart/alternative; boundary="' . $fronteira . "\"\r\n";
$corpo  = "--$fronteira\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($texto)) . "\r\n";
$corpo .= "--$fronteira\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html)) . "\r\n";
$corpo .= "--$fronteira--\r\n";

$nome = limpo($env['nome'] ?? '');
$destino = $nome !== '' ? cabecalho($nome) . ' <' . $para . '>' : $para;
$ok = @mail($destino, cabecalho(limpo($env['assunto'])), $corpo, $h, '-f' . REMETENTE);

funcao($token, ['acao' => 'hostinger_resultado', 'envio_id' => $id, 'ok' => (bool)$ok, 'erro' => $ok ? '' : 'O servidor de e-mail da Hostinger recusou o envio']);
if (!$ok) sair(502, ['erro' => 'falha_envio']);
sair(200, ['ok' => true]);
