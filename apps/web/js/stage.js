/* Escala o "palco" de 1024px (largura da arte aprovada) para a largura da janela,
   preservando proporções, posições e hierarquia pixel a pixel.
   Abaixo de 760px o layout troca para a versão responsiva (sem escala). */
(function () {
  var BASE = 1024, MOBILE = 760, MAX = 1.875;
  function fit() {
    var w = document.documentElement.clientWidth || window.innerWidth;
    var root = document.documentElement;
    if (w < MOBILE) { root.classList.add('is-mobile'); root.style.setProperty('--z', 1); return; }
    root.classList.remove('is-mobile');
    root.style.setProperty('--z', Math.min(w / BASE, MAX).toFixed(5));
  }
  fit();
  window.addEventListener('resize', fit, { passive: true });
  document.addEventListener('DOMContentLoaded', fit);
})();
