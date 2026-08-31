// Ollama'nın HAM cevabını dökerek "düşünme kapalı mı" sorusunu netleştirir.
// qwen3:4b, think:false gönderilmesine rağmen akıl yürütmesini cevap diye
// bastı — bunun modelden mi yoksa bizim isteğimizden mi geldiğini ayırır.
//
//   node tools/ollama-ham-probe.js qwen3:4b
const model = process.argv[2] || 'qwen3:4b';

(async () => {
  const govde = {
    model,
    messages: [{ role: 'user', content: 'Şu cümleyi Türkçeye çevir, sadece çeviriyi yaz: "The remote certificate is invalid."' }],
    stream: false,
    think: false,
    options: { temperature: 0.2, num_predict: 300 },
    keep_alive: '2m',
  };

  const t0 = Date.now();
  const r = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(govde),
  });
  const j = await r.json();

  console.log(`model: ${model} · ${((Date.now() - t0) / 1000).toFixed(1)} sn · HTTP ${r.status}`);
  if (j.error) { console.log('HATA:', j.error); return; }

  const m = j.message || {};
  console.log('mesaj alanlari :', Object.keys(m).join(', '));
  console.log('thinking alani :', m.thinking ? `DOLU (${m.thinking.length} karakter)` : 'boş/yok');
  console.log('content uzunlk :', (m.content || '').length);
  console.log('--- content ---');
  console.log((m.content || '').slice(0, 700));
})();
