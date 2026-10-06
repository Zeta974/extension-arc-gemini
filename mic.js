const status = document.getElementById("status");

async function requestMic() {
  status.textContent = "Demande en cours…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    status.textContent = "Micro autorisé ✓ Tu peux fermer cet onglet et rouvrir Gemini sur le PDF.";
    setTimeout(() => window.close(), 1800);
  } catch (error) {
    status.textContent = error?.name === "NotAllowedError"
      ? "Micro refusé. Clique sur l’icône du cadenas/caméra dans la barre d’adresse pour l’autoriser, puis réessaie."
      : error?.message || "Impossible d’accéder au micro.";
  }
}

document.getElementById("allow").addEventListener("click", requestMic);
requestMic();
