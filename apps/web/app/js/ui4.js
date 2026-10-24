/* Login/cadastro 4.0 — aprovado e padrão em produção desde 23/10/2026.
 * Layout anterior (contingência): /app/?ui=classico#/entrar  ·  voltar à 4.0: /app/?ui=4#/entrar */
export const UI4 = (() => {
  try {
    const q = new URLSearchParams(location.search).get("ui");
    if (q === "4") localStorage.removeItem("aurion.ui");
    if (q === "classico") localStorage.setItem("aurion.ui", "classico");
    return localStorage.getItem("aurion.ui") !== "classico";
  } catch { return true; }
})();
