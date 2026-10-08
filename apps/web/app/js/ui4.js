/* Homologação da experiência de login/cadastro 4.0.
 * Ativar: /app/?ui=4#/cadastro  ·  voltar ao layout anterior: /app/?ui=classico#/entrar
 * Depois da aprovação, basta trocar o padrão abaixo para ligar a 4.0 para todos. */
export const UI4 = (() => {
  try {
    const q = new URLSearchParams(location.search).get("ui");
    if (q === "4") localStorage.setItem("aurion.ui", "4");
    if (q === "classico") localStorage.removeItem("aurion.ui");
    return localStorage.getItem("aurion.ui") === "4";
  } catch { return false; }
})();
