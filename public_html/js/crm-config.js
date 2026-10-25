/* Conexão com o banco do CRM (Supabase · projeto danova-crm).
 * A chave abaixo é PÚBLICA (anon): só permite o que as regras de segurança do banco liberam —
 * enviar leads e acessar dados após login. Nunca coloque aqui a chave "service_role". */
window.DANOVA_CRM = {
  url: "https://oeylfwasqvbnybzrwtgf.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9leWxmd2FzcXZibnlienJ3dGdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NDkxNDYsImV4cCI6MjEwODEyNTE0Nn0.xfl5HyVe4RGqs0VYNt-a7Rox1Ro9ORQlkdNirxG3FeY",
  // Agente de voz ElevenLabs (público; o ID não é segredo). Deixe "" para usar o modo de voz antigo (Whisper/navegador).
  elevenAgentId: "agent_9101m5t5g6gfe0ns594fy3v2b3dn"
};
