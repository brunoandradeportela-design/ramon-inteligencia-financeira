# Geração dos ativos da marca

1. `seg.py` separa as partes prateada e ciano do símbolo na arte oficial (`aurion-logo-oficial.jpg`) e grava as máscaras.
2. `trace.py` vetoriza as máscaras (potrace) em `silver.d` e `cyan.d`.
3. `make_assets.py` monta logos, favicon, ícones do app, ícones de computador e a imagem de compartilhamento em `apps/web/assets/brand/`.

Requisitos: `pip install opencv-python-headless potracer cairosvg fonttools brotli pillow`. As fontes (Montserrat 700 e Open Sans 500, licença OFL) vão em `tools/brand/fonts/` (`npm pack @fontsource/montserrat @fontsource/open-sans`).
Com um vetor oficial em mãos, substitua `silver.d`/`cyan.d` pelos caminhos dele e rode só o passo 3.

## Recortes fiéis à arte (usados em fundo escuro e nos ícones)

4. `cutout.py` recorta símbolo, nome e assinatura da arte oficial com transparência (estima o fundo e calcula o alfa).
5. `make_art.py` gera `*-art.png`, os ícones do app e do computador e `og-aurion.png` a partir desses recortes.
