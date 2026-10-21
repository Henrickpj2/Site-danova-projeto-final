<?php
/**
 * danova-ai.com — receptor de leads (substitui o /api/lead que hoje retorna 404)
 *
 * Recebe POST (JSON ou formulário) dos formulários do site e:
 *   1) envia um e-mail para LEAD_TO
 *   2) grava uma linha em ../../leads-danova/leads.csv (FORA do public_html, não acessível pela web)
 *
 * Instalação: subir este arquivo em public_html/api/lead.php
 * O .htaccess incluído em public_html/api/ faz /api/lead apontar para este arquivo.
 */

// ===================== CONFIGURAÇÃO =====================
const LEAD_TO   = 'danielle@danova-ai.com';      // quem recebe os leads
const LEAD_FROM = 'site@danova-ai.com';          // precisa ser um e-mail do domínio (crie na Hostinger > E-mails)
const ALLOWED_ORIGINS = ['https://danova-ai.com', 'https://www.danova-ai.com'];
// CRM (Supabase · projeto danova-crm) — chave pública "anon"; só consegue chamar enviar_lead
const CRM_URL  = 'https://oeylfwasqvbnybzrwtgf.supabase.co';
const CRM_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9leWxmd2FzcXZibnlienJ3dGdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NDkxNDYsImV4cCI6MjEwODEyNTE0Nn0.xfl5HyVe4RGqs0VYNt-a7Rox1Ro9ORQlkdNirxG3FeY';
// ========================================================

header('Content-Type: application/json; charset=utf-8');
header('X-Robots-Tag: noindex');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin && in_array($origin, ALLOWED_ORIGINS, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method_not_allowed']);
    exit;
}
if ($origin && !in_array($origin, ALLOWED_ORIGINS, true)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'origin_not_allowed']);
    exit;
}

// Lê JSON ou form-data
$raw  = file_get_contents('php://input', false, null, 0, 65536);
$data = json_decode($raw ?: '', true);
if (!is_array($data)) { $data = $_POST; }

// Honeypot anti-spam: campo invisível "website" deve vir vazio
if (!empty($data['website'])) { echo json_encode(['ok' => true]); exit; }

$fields = [
    'name', 'email', 'phone', 'message', 'source', 'language', 'page', 'lead_page',
    'budget', 'timeline', 'goal', 'country', 'lead_temperature',
    'first_touch_source', 'first_touch_medium', 'first_touch_campaign',
    'last_touch_source', 'last_touch_medium', 'last_touch_campaign',
    'utm_content', 'utm_term', 'gclid', 'fbclid', 'landing_page', 'referrer',
    'objective', 'interest', 'unit_type', 'is_realtor', 'address', 'quiz_profile', 'source_context', 'channel',
];
$lead = [];
foreach ($fields as $f) {
    $v = isset($data[$f]) ? (is_scalar($data[$f]) ? (string)$data[$f] : json_encode($data[$f])) : '';
    $v = trim(str_replace(["\r", "\n"], ' ', $v));
    $lead[$f] = mb_substr(strip_tags($v), 0, 1000);
}

$email = filter_var($lead['email'], FILTER_VALIDATE_EMAIL);
if (!$email && $lead['phone'] === '') {
    http_response_code(422);
    echo json_encode(['ok' => false, 'error' => 'email_or_phone_required']);
    exit;
}

// Limite simples: 10 envios por IP a cada 10 min
$ip  = $_SERVER['REMOTE_ADDR'] ?? '0';
$dir = dirname(__DIR__, 2) . '/leads-danova';
if (!is_dir($dir)) { @mkdir($dir, 0750, true); }
$rl  = $dir . '/rate-' . md5($ip) . '.txt';
$hits = array_filter(explode(',', @file_get_contents($rl) ?: ''), fn($t) => $t && (time() - (int)$t) < 600);
if (count($hits) >= 10) { http_response_code(429); echo json_encode(['ok' => false, 'error' => 'rate_limited']); exit; }
$hits[] = time();
@file_put_contents($rl, implode(',', $hits));

// Evita lead duplicado: o mesmo e-mail/telefone recebido de novo em até 3 min
// (alguns formulários do site enviam por dois caminhos) é ignorado.
$dupKey = $dir . '/dup-' . md5(strtolower($lead['email'] ?: $lead['phone'])) . '.txt';
$last = (int)@file_get_contents($dupKey);
if ($last && (time() - $last) < 180) { echo json_encode(['ok' => true, 'duplicate' => true]); exit; }
@file_put_contents($dupKey, (string)time());

// Grava CSV
$csv = $dir . '/leads.csv';
$isNew = !file_exists($csv);
if ($fh = @fopen($csv, 'a')) {
    if (flock($fh, LOCK_EX)) {
        if ($isNew) { fputcsv($fh, array_merge(['received_at', 'ip'], $fields)); }
        // evita que o Excel interprete conteúdo malicioso como fórmula
        $safe = array_map(fn($v) => preg_match('/^[=+\-@\t]/', $v) ? "'" . $v : $v, array_values($lead));
        fputcsv($fh, array_merge([gmdate('c'), $ip], $safe));
        flock($fh, LOCK_UN);
    }
    fclose($fh);
}

// CRM: o formulário principal (leadForm) já envia direto ao CRM pelo navegador;
// os demais formulários do site (livro etc.) entram no CRM por aqui.
if ($lead['source'] !== 'leadForm' && function_exists('curl_init')) {
    $ch = curl_init(CRM_URL . '/rest/v1/rpc/enviar_lead');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 6,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'apikey: ' . CRM_ANON, 'Authorization: Bearer ' . CRM_ANON],
        CURLOPT_POSTFIELDS => json_encode(['dados' => $lead], JSON_UNESCAPED_UNICODE),
    ]);
    @curl_exec($ch);
    curl_close($ch);
}

// E-mail
$subject = 'Novo lead site Danova: ' . ($lead['name'] ?: $lead['email'] ?: $lead['phone'])
         . ' [' . ($lead['lead_page'] ?: $lead['page'] ?: 'site') . ']';
$body = "Novo contato recebido pelo site danova-ai.com\n\n";
foreach ($lead as $k => $v) { if ($v !== '') { $body .= str_pad($k, 22) . ": $v\n"; } }
$body .= "\nVer no CRM: https://danova-ai.com/crm/#leads\n";
$body .= "\nRecebido em: " . gmdate('d/m/Y H:i') . " UTC\n";
$headers  = 'From: Site Danova <' . LEAD_FROM . ">\r\n";
if ($email) { $headers .= 'Reply-To: ' . $email . "\r\n"; }
$headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
$mailed = @mail(LEAD_TO, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $headers);

echo json_encode(['ok' => true, 'mailed' => (bool)$mailed]);
