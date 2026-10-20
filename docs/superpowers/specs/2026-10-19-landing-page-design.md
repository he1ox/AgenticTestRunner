# Landing page de qa-runner (AgenticTestRunner): diseño y plan

## Contexto

qa-runner ya tiene un README sólido (evidencia, sign-off humano, replays a $0, CI, export a
Playwright), pero no tiene una página propia. La idea es una landing que convierta al visitante
de skills.sh o GitHub en una instalación (`npx skills add he1ox/AgenticTestRunner`) y que
muestre lo que hace el producto en lugar de solo describirlo.

Referencias que se revisaron (2026-10-19):
- **Orca** (onorca.dev): el screenshot del producto como héroe y la tabla comparativa.
- **agent-browser** (agent-browser.dev): el bloque de instalación es el CTA, junto con un comando real y su output.
- **skills.sh**: el marquee de agentes y el wordmark monoespaciado.
- **E2B** (e2b.dev): recursos para agentes (`llms.txt`).

Decisiones tomadas en el brainstorming:
- **Estilo:** mezcla A + B. El hero es neo-swiss claro (papel, tinta, un acento lima) y la mitad central es acidwave oscura.
- **Ubicación:** carpeta `site/` en este mismo repo, publicada en GitHub Pages con un workflow. Sin dependencias npm ni build step.
- **Idioma:** inglés.
- **Pieza central:** una animación en dos actos, justo debajo del hero. En el acto 1, un agente prueba un flujo, decide capturar y marca la captura (pasos, caja, flecha). En el acto 2, tres agentes prueban flujos distintos del mismo sistema en paralelo y uno falla, esperando tu sign-off.
- **Segunda animación (§ 02, en claro):** human in the loop, memoria y dashboard en 4 escenas. Reemplaza el log de terminal y las 4 decisiones estáticas. La página alterna entre lo que hacen los agentes (oscuro) y lo que decides tú (claro).

## Sistema visual

- **Tokens** en `:root`:
  - `--paper #F2F0EA`, `--ink #0B0B0B`, `--acid #C6FF00`, `--hot #FF3EA5` (solo FAIL y énfasis), `--ask #FFB020`
  - `--void #0A0A0A`, `--line-dark #333`, `--muted #8A8A8A`
- **Tipografía:** Inter Tight (800/900 para display, tracking -0.04em) y JetBrains Mono para metadatos y código, ambas desde Google Fonts con `display=swap` y system stack de fallback.
- **Retícula** de 12 columnas, bordes de 1.5px en tinta y numeración de secciones (`§ 01`).
- **Ácido controlado:** la deformación `scaleY` se usa solo en el `$0` y el wordmark. El rosa queda reservado para FAIL. Nada de gradientes ni ruido.
- **Ritmo:** claro (hero) → banda marquee lima (bisagra) → oscuro (agentes probando) → claro (tú decides: HITL, memoria, dashboard) → oscuro ($0, CI, export) → claro (comparativa, instalación) → footer oscuro.
- **Cursores:** el agente lleva una flecha lima con la etiqueta `agent-N` y el humano una flecha en tinta con la etiqueta rosa `you`. Se usan igual en las dos animaciones.
- **La página es siempre clara/oscura por secciones**, no sigue el tema del sistema. Es una decisión deliberada: el contraste entre secciones es el diseño.

## Secciones (orden final)

| § | Tema | Contenido (fuente: README) |
|---|---|---|
| nav | claro | wordmark `qa-runner®` · Evidence · Replays · CI · Install · ★ GitHub |
| 00 hero | claro | "Your test cases. Run by browser agents. **Signed off by you.**" con lima. Columna meta (versión, MIT, 0 npm deps, 7 harnesses), subtítulo e install block con botón copiar |
| marquee | lima | Claude Code ✱ Codex ✱ Cursor ✱ Gemini CLI ✱ OpenCode ✱ Copilot CLI ✱ VS Code |
| 01 watch it test | oscuro | La animación de dos actos (prototipo aprobado), con un botón Replay |
| 02 you sign off | claro | Animación HITL de 4 escenas (ver abajo), con un headline tipo "Every answer you approve makes the next run need you less." y un índice 01–04 que se ilumina en lima con la escena activa |
| 03 $0 replays | oscuro | `$0` gigante deformado y snippets de `suite run smoke --ci --junit` y `export --tag smoke` |
| 04 how it compares | claro | Tabla suiza: qa-runner vs Playwright Test Agents vs AI platforms vs browser agents (textos del README) |
| 05 install | claro | Tabs por agente (Claude Code, Codex, Copilot, Cursor, Gemini, VS Code, other), con los comandos exactos del README. Línea "For agents → llms.txt" |
| footer | oscuro | Docs (README), Changelog, Roadmap, License MIT, GitHub |

No hay testimonios ni FAQ hasta que existan citas reales.

## Animación (§ 01)

Se porta el prototipo mostrado en el chat a `site/main.js` y `site/styles.css`:
- **Acto 1** (`acme.shop/cart`, agent-1 · haiku): el log razona, escribe SAVE10, aplica y el total pasa de $46.00 a $41.40. Ahí decide capturar: flash, miniatura en `evidence/`, pasos ①②, caja y flecha en SVG (`stroke-dashoffset`), y termina en PASS.
- **Acto 2:** tres ventanas (`/login` haiku, `/cart` haiku, `/checkout` sonnet) arrancan escalonadas. Cada una hace su captura y su caja. Checkout termina en FAIL rosa, y el resumen dice "3 isolated browsers · 3 png · 1 FAIL waiting for your sign-off".
- Loop con token de cancelación (como en el prototipo) y botón Replay.
- Arranca con un `IntersectionObserver` y se pausa fuera de la pantalla.
- Con `prefers-reduced-motion` muestra el estado final de cada acto, sin transiciones.
- **Móvil (<720px):** el log va debajo de la ventana y en el acto 2 las ventanas se apilan; si no caben, solo se muestran dos.
- Accesibilidad: `aria-live="polite"` en el log y un resumen en texto para lectores de pantalla.

## Animación (§ 02, human in the loop)

Se porta el segundo prototipo aprobado. Es un viewer simulado (`127.0.0.1:4321`) con una columna `.qa/memory/` que se va llenando:
1. **Answer once:** agent-2 pregunta por la cuenta que aprueba reembolsos. El cursor `you` escribe `qa-approver-01 · env:QA_APPROVER`, marca Remember y envía. Aparece una memoria nueva y el agente retoma.
2. **Review every verdict:** apruebas 3 casos PASS y rechazas el FAIL ("Needs retest"). El retest corre 1 de 4 casos en sonnet y pasa. Los casos aprobados se convierten en scripts.
3. **Approve what agents learn:** llegan dos lecciones propuestas. Una se aprueba y pasa a memoria; la otra se descarta y queda atenuada. El caption dice que nada se reusa sin tu aprobación y que `.qa/memory/` se comparte vía commit.
4. **Dashboard:** las tiles de pass rate, failures, agent time/case y reviewer agreement cuentan hacia arriba. Las barras de costo por run bajan de $1.84 a $1.12 y $0.61 (run 1–3, agente) y quedan en $0 en los 3 replays, en lima. Las preguntas por run, en rosa: 5, 3, 1, 0.
- Los números llevan la etiqueta "example data" en la sección.
- Comparte con § 01 los helpers de animación: el token de cancelación, los cursores, el `IntersectionObserver`, reduced motion (muestra un dashboard estático con todas las memorias) y el log con `aria-live`.
- **Móvil:** la columna de memoria va debajo del viewer y el dashboard pasa a tiles de 2×2.

## Archivos

Nuevos:
- `site/index.html`: todo el marcado, metadatos OG/Twitter y un favicon SVG inline.
- `site/styles.css`: tokens, retícula, secciones, marquee y estilos de la animación.
- `site/main.js`: la animación, el botón copiar del install, las tabs de instalación y el marquee (pausa con reduced motion). Vanilla, sin módulos externos.
- `site/llms.txt`: qué es qa-runner, el comando de instalación y enlaces a los `SKILL.md` y al README.
- `site/og.png` (opcional, menos de 100 KB) o una OG image SVG.
- `.github/workflows/pages.yml`: se ejecuta con push a `main` que toque `site/**`, más `workflow_dispatch`. Usa `actions/configure-pages`, `actions/upload-pages-artifact` (`path: site`) y `actions/deploy-pages`, con permisos `pages: write` e `id-token: write`.
- `docs/superpowers/specs/2026-10-19-landing-page-design.md`: copia de este diseño.

Modificados:
- `scripts/bump-version.mjs`: un `edit('site/index.html', …)` más que reemplaza la versión dentro de `data-version="…"`, igual que el patrón que ya existe para `skills/run-test-plan/README.md`.
- `README.md`: enlace a la landing debajo de los badges.
- `CHANGELOG.md`: una sección "Unreleased" con la entrada de la landing. No hace falta cambiar la versión.

Sin tocar: `skills/`, los manifiestos generados y `scripts/build.mjs`. La landing no forma parte de ninguna skill, y `npx skills add` solo copia `skills/`.

Peso objetivo: `site/` por debajo de 80 KB sin fuentes. No se copian los GIFs de `docs/`, porque la animación los reemplaza, y así el clon de los plugins sigue siendo liviano.

## Pasos

1. Crear la rama `feat/landing-page` desde `main`, guardar el spec en `docs/superpowers/specs/` y hacer commit.
2. Escribir `site/index.html` y `styles.css` con el hero, el marquee y las secciones 02–05 y el footer.
3. Portar las dos animaciones (§ 01 agentes, § 02 HITL) a `main.js` con helpers compartidos, sumando IntersectionObserver, reduced motion y layout móvil.
4. Agregar las tabs de instalación, el botón copiar y `llms.txt`.
5. Escribir el workflow de Pages, el cambio en `bump-version.mjs`, el enlace en el README y la entrada del CHANGELOG.
6. Verificar (ver abajo) y abrir el PR. Activar Pages en la configuración del repo (Settings → Pages → Source: GitHub Actions) lo tiene que hacer el usuario o confirmarlo antes.

## Verificación

- Servir en local con `npx -y http-server site -p 4173`, o con un one-liner `node:http` en el scratchpad, y abrirlo en el browser integrado:
  - Desktop (1280px) y móvil (375px), sin scroll horizontal.
  - Que § 01 recorra los dos actos y § 02 las 4 escenas, y que Replay funcione en ambas.
  - Que solo corra la animación visible (scroll entre ambas).
  - Que con `prefers-reduced-motion` la página quede estática.
  - Que el botón copiar copie exactamente `npx skills add he1ox/AgenticTestRunner`.
  - Que las tabs muestren los comandos del README.
  - Que la consola no tenga errores.
- `node scripts/validate-skills.mjs` y `node scripts/build.mjs --check` siguen en verde.
- `node scripts/bump-version.mjs 0.9.0` termina sin el error "version not found". Revertir con git si cambia algo.
- Validar el YAML del workflow. El deploy real se ve en Actions después del merge.
