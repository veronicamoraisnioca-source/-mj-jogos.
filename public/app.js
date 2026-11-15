const $ = id => document.getElementById(id);

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  $("result").textContent = "A registar a tua inscrição...";
  try {
    const r = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: $("name").value, phone: $("phone").value })
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "Erro ao criar inscrição.");
    $("check").value = d.id;
    $("result").innerHTML = `
      <div class="payment-box">
        <h3>🕒 Inscrição recebida!</h3>
        <p>O teu pagamento ainda precisa de ser confirmado pelo MJ JOGOS.</p>
        <p>Guarda o código da inscrição:</p>
        <h2>${d.id}</h2>
        <a class="whatsapp-btn" target="_blank" rel="noopener" href="${d.whatsapp}">ENVIAR CONFIRMAÇÃO PELO WHATSAPP</a>
        <p>Depois de abrir o WhatsApp, carrega em ENVIAR.</p>
        <p>O código para jogar só será disponibilizado depois da confirmação do pagamento.</p>
      </div>`;
  } catch (err) {
    $("result").textContent = err.message;
  }
});

$("checkBtn").addEventListener("click", async () => {
  const id = $("check").value.trim();
  if (!id) { $("status").textContent = "Introduza o código da inscrição."; return; }
  try {
    const r = await fetch("/api/status/" + encodeURIComponent(id));
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "Não foi possível consultar.");
    $("status").textContent = d.status === "approved"
      ? "Pagamento confirmado! O teu código de acesso é: " + d.accessCode
      : "Inscrição pendente. Aguarda a confirmação do pagamento.";
  } catch (err) { $("status").textContent = err.message; }
});

$("playBtn").addEventListener("click", async () => {
  const code = $("gameCode").value.trim();
  const box = $("game");
  box.textContent = "A verificar o acesso...";
  try {
    const r = await fetch("/api/play/" + encodeURIComponent(code));
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "Não foi possível entrar.");
    let index = 0, score = 0;
    function show() {
      if (index >= d.questions.length) {
        box.innerHTML = `<h3>Fim do jogo, ${d.player}!</h3><p>Acertaste ${score} de ${d.questions.length} perguntas.</p>`;
        return;
      }
      const q = d.questions[index];
      box.innerHTML = `<h3>Pergunta ${index + 1}/${d.questions.length}</h3><p>${q.q}</p>` +
        q.a.map((a, i) => `<button class="secondary answer" data-i="${i}">${a}</button>`).join("");
      box.querySelectorAll(".answer").forEach(b => b.addEventListener("click", () => {
        if (Number(b.dataset.i) === q.correct) score++;
        index++; show();
      }));
    }
    show();
  } catch (err) { box.textContent = err.message; }
});
     
