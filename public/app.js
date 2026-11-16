const $ = id => document.getElementById(id);

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  const file = $("proof").files[0];
  if (!file) {
    $("result").textContent = "Seleciona a captura da mensagem de confirmação.";
    return;
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    $("result").textContent = "Seleciona uma imagem JPG, PNG ou WEBP.";
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    $("result").textContent = "A captura deve ter no máximo 5 MB.";
    return;
  }

  $("result").textContent = "A criar a inscrição...";
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
        <h3>🕒 Inscrição criada!</h3>
        <p>O comprovativo não foi enviado nem guardado no site.</p>
        <p>Referência da inscrição:</p><h2>${String(d.id).replace(/[&<>"']/g, "")}</h2>
        <p>O WhatsApp vai abrir. Anexa manualmente a captura selecionada e envia a mensagem.</p>
        <a class="whatsapp-btn" target="_blank" rel="noopener" href="${d.whatsapp}">ABRIR WHATSAPP E ENVIAR COMPROVATIVO</a>
        <p>Se o WhatsApp não abrir, usa o número 852 487 728 e informa a referência acima.</p>
        <p>A inscrição só será aprovada depois de confirmar o recebimento real do pagamento.</p>
      </div>`;
    const whatsappUrl = d.whatsapp;
    window.open(whatsappUrl, "_blank", "noopener");
    $("form").reset();
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
      : d.status === "blocked"
        ? "Inscrição bloqueada. Contacte o suporte."
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
        
