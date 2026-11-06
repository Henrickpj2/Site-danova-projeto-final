<?php
/**
 * danova-ai.com — fila do Agente de E-mails (envios agendados e aprovados no CRM).
 *
 * Chamado pela função email-agente do Supabase (a cada 5 minutos) com { envio_id, ticket }.
 * O ticket é de uso único e vale 3 minutos: este arquivo o troca pelo e-mail pronto na própria função
 * (ação "buscar") e envia pelo servidor de e-mail da Hostinger. Nenhuma chave secreta fica aqui.
 */
const REMETENTE      = 'danova-ai@danova-ai.com';
const REMETENTE_NOME = 'DANOVA-AI';
const CRM_URL  = 'https://oeylfwasqvbnybzrwtgf.supabase.co';
const CRM_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9leWxmd2FzcXZibnlienJ3dGdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NDkxNDYsImV4cCI6MjEwODEyNTE0Nn0.xfl5HyVe4RGqs0VYNt-a7Rox1Ro9ORQlkdNirxG3FeY';

header('Content-Type: application/json; charset=utf-8');
header('X-Robots-Tag: noindex');
header('Cache-Control: no-store');
function sair($codigo, $dados) { http_response_code($codigo); echo json_encode($dados, JSON_UNESCAPED_UNICODE); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') sair(405, ['erro' => 'metodo']);

$in = json_decode(file_get_contents('php://input') ?: '', true);
$id = (string)($in['envio_id'] ?? '');
$ticket = (string)($in['ticket'] ?? '');
if (!preg_match('/^[0-9a-f-]{36}$/i', $id) || !preg_match('/^[0-9a-f-]{40,100}$/i', $ticket)) sair(400, ['erro' => 'dados_invalidos']);

$ch = curl_init(CRM_URL . '/functions/v1/email-agente');
curl_setopt_array($ch, [
    CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'apikey: ' . CRM_ANON, 'Authorization: Bearer ' . CRM_ANON],
    CURLOPT_POSTFIELDS => json_encode(['acao' => 'buscar', 'envio_id' => $id, 'ticket' => $ticket]),
]);
$r = curl_exec($ch); $st = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
$env = json_decode($r ?: '', true) ?: [];
if ($st !== 200 || empty($env['ok'])) sair(403, ['erro' => 'ticket_invalido']);

function cabecalho($t) { return '=?UTF-8?B?' . base64_encode($t) . '?='; }
function limpo($t) { return trim(str_replace(["\r", "\n"], ' ', (string)$t)); }
$para = limpo($env['para']);
if (!filter_var($para, FILTER_VALIDATE_EMAIL)) sair(400, ['erro' => 'email_invalido']);
$responder = filter_var(limpo($env['responder'] ?? ''), FILTER_VALIDATE_EMAIL) ?: REMETENTE;
$html = (string)$env['html'];
$texto = trim(html_entity_decode(strip_tags(preg_replace(['/<(br|\/p|\/li|\/h2|\/h3|\/tr)[^>]*>/i', '/<li[^>]*>/i'], ["\n", "\n• "], $html)), ENT_QUOTES, 'UTF-8'));
$texto = preg_replace("/\n{3,}/", "\n\n", preg_replace("/[ \t]+/", ' ', $texto));
$fronteira = 'dnv-' . bin2hex(random_bytes(12));

$h  = 'From: ' . cabecalho(REMETENTE_NOME) . ' <' . REMETENTE . ">\r\n";
$h .= 'Reply-To: ' . $responder . "\r\n";
$h .= 'Message-ID: <' . $id . "@danova-ai.com>\r\n";
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
if (!$ok) sair(502, ['erro' => 'mail_recusado']);
sair(200, ['ok' => true]);
