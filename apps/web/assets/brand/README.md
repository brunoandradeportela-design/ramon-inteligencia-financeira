# Identidade visual AURION (2026)

Símbolo "A" prateado com elemento interno azul-ciano, nome **AURION** em Montserrat Bold e assinatura **INTELIGÊNCIA FINANCEIRA, TRIBUTÁRIA E DE MERCADO**.

Os vetores foram **recriados a partir da arte oficial enviada em 23/10/2026** (imagem rasterizada). Quando houver o arquivo vetorial oficial (AI, SVG ou PDF), ele deve substituir `aurion-symbol*.svg` e os demais arquivos devem ser gerados de novo.

| Arquivo | Uso |
|---|---|
| `aurion-logo-primary.svg` | Logo institucional empilhada (símbolo + AURION® + assinatura) para fundo escuro |
| `aurion-logo-primary-dark.svg` | A mesma, para fundo claro |
| `aurion-logo-light.svg` | Logo horizontal (símbolo + AURION) para fundo escuro |
| `aurion-logo-dark.svg` | Logo horizontal para fundo claro |
| `aurion-symbol.svg` | Símbolo isolado, prateado e ciano (fundo escuro) |
| `aurion-symbol-dark.svg` | Símbolo isolado, marinho e ciano (fundo claro) |
| `aurion-symbol-mono.svg` | Símbolo em uma cor (`currentColor`), para carimbos e impressão |
| `favicon.svg`, `favicon.ico` | Favicon (símbolo sobre marinho). Cópias em `/assets/img/favicon.svg` e `/favicon.ico` |
| `aurion-icon-512.png`, `apple-touch-icon.png` | Ícones de alta resolução |
| `og-aurion.png` / `.svg` | Imagem de compartilhamento (1200×630) usada em `og:image` |
| `desktop/aurion.ico` | Windows (16 a 256 px) |
| `desktop/aurion.icns` | macOS |
| `desktop/aurion-16.png` … `aurion-1024.png` | Linux e lojas |

## Cores

| Token | Valor | Uso |
|---|---|---|
| `--aurion-navy` | `#071B32` | Fundo institucional, splash, ícones |
| `--aurion-navy-2` | `#0B2440` | Símbolo e nome em fundo claro |
| `--aurion-cyan` | `#20C7E8` | Destaque do símbolo em fundo escuro |
| `--aurion-cyan-d` | `#0E9FC4` | Destaque do símbolo em fundo claro (contraste) |
| `--aurion-silver` | `#D9E1E8` | Símbolo e nome em fundo escuro |

As cores semânticas (positivo, negativo, alerta, crítico) não mudaram.

## Aplicativo de computador

O AURION não tem empacotamento Electron ou Tauri: no computador ele é o **app instalável (PWA)** pelo Chrome ou Edge, que usa os ícones do `app/manifest.webmanifest` (atalho no menu Iniciar, barra de tarefas, Dock e Launchpad). Os arquivos `.ico`, `.icns` e PNG de `desktop/` ficam prontos para um empacotamento nativo futuro.

Fontes: Montserrat 700 (SIL Open Font License) em `assets/fonts/`; os textos dos SVG estão convertidos em curvas.
