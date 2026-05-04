# Plano de Redesign Visual — apps/web

## Contexto

Dashboard interno B2B (1 usuário operador), Next 15 + Tailwind + shadcn-style. Diagnóstico (auditoria completa em sessão de 2026-05-04): tem fundação sólida mas parece **genérico/cru** — cores duplicadas, tipografia ad-hoc, espaçamento sem ritmo, tabelas sem hover/zebra, modo escuro com contraste cansativo, marca invisível ("AM" em caixa), zero microinteração.

Referência mental: **Linear / Vercel Dashboard / Resend / Cal.com**. Esses são B2B com cara polida — não precisa marketing fancy, só ritmo visual claro e detalhes bem cuidados.

**Objetivo do plano:** levar o dashboard de "amador" → "profissional B2B" sem virar projeto de design de 2 meses. 4 fases incrementais, cada uma já melhora visivelmente.

---

## Princípios

1. **Não inventar — adotar tokens.** Toda mudança vira CSS variable em `globals.css`. Componentes consomem tokens. Trocar tema vira 1 linha.
2. **Densidade calibrada.** B2B operacional precisa ver muita info, mas não apertada. 16/24/32 spacing rígido.
3. **Feedback em todo lugar.** Loading, empty, hover, focus, success, error — sem estado mudo.
4. **Marca leve mas presente.** Cor única + tipografia + ícone = identidade. Não precisa rebrand caro.

---

## Fase 1 — Fundação visual (P0 + P1, ~2-3h)

### 1.1 Tokens CSS (em `apps/web/src/app/globals.css`)

Substituir `:root` e `.dark` pelas escalas abaixo:

```css
:root {
  /* Surfaces */
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --muted: 210 40% 96%;
  --muted-foreground: 215 16% 47%;

  /* Brand (mude pro que casar com a marca afiliado-master) */
  --primary: 222 47% 11%;        /* texto-padrão escuro */
  --primary-foreground: 210 40% 98%;
  --accent: 217 91% 60%;          /* azul vivo — foco, links, CTAs secundárias */
  --accent-foreground: 0 0% 100%;

  /* Semantic */
  --success: 142 71% 45%;
  --success-foreground: 0 0% 100%;
  --warning: 38 92% 50%;
  --warning-foreground: 0 0% 0%;
  --destructive: 0 72% 51%;
  --destructive-foreground: 0 0% 100%;

  /* UI */
  --border: 214 32% 91%;
  --input: 214 32% 91%;
  --ring: 217 91% 60%;            /* MESMO do accent — foco visível */
  --radius: 0.625rem;             /* 10px — Linear-ish */
}

.dark {
  --background: 222 14% 9%;       /* não puro preto — confortável */
  --foreground: 210 40% 96%;
  --card: 222 14% 11%;
  --card-foreground: 210 40% 96%;
  --muted: 222 14% 15%;
  --muted-foreground: 215 20% 70%;

  --primary: 210 40% 96%;
  --primary-foreground: 222 47% 11%;
  --accent: 217 91% 65%;
  --accent-foreground: 222 47% 11%;

  --success: 142 65% 50%;
  --warning: 38 92% 55%;
  --destructive: 0 72% 55%;

  --border: 222 14% 18%;
  --input: 222 14% 18%;
  --ring: 217 91% 65%;
}
```

**Por que muda muito:** `--accent` passa a ser azul vivo distinto de `--secondary`; `--ring` mesmo do accent (foco aparece de longe); dark mode sai de "preto contraste máximo" pra "cinza confortável" (13:1 ao invés de 17:1).

### 1.2 Tailwind config (em `apps/web/tailwind.config.ts`)

Adicionar:

```ts
extend: {
  colors: {
    success: 'hsl(var(--success) / <alpha-value>)',
    'success-foreground': 'hsl(var(--success-foreground) / <alpha-value>)',
    warning: 'hsl(var(--warning) / <alpha-value>)',
    'warning-foreground': 'hsl(var(--warning-foreground) / <alpha-value>)',
  },
  fontSize: {
    xs: ['0.75rem', { lineHeight: '1rem' }],
    sm: ['0.875rem', { lineHeight: '1.25rem' }],
    base: ['1rem', { lineHeight: '1.5rem' }],
    lg: ['1.125rem', { lineHeight: '1.75rem' }],
    xl: ['1.25rem', { lineHeight: '1.75rem' }],
    '2xl': ['1.5rem', { lineHeight: '2rem' }],
    '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
    '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
  },
  ringWidth: { DEFAULT: '2px' },
  ringOffsetWidth: { DEFAULT: '2px' },
}
```

### 1.3 Componentes UI

**Button** (`apps/web/src/components/ui/button.tsx`): trocar `default: 'h-9 px-4'` por `default: 'h-10 px-4'`. CTAs ficam com peso visual decente.

**Input** (`apps/web/src/components/ui/input.tsx`): trocar `focus-visible:ring-1 focus-visible:ring-ring` por `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`. Foco vira destaque, não sussurro.

**Badge** (`apps/web/src/components/ui/badge.tsx`): trocar cores hardcoded (`bg-emerald-500`) pelas tokens novas (`bg-success text-success-foreground`).

### Verificação fase 1
- Recarregar qualquer tela. CTAs primárias 4px mais altas, foco do input com ring azul claro, badges semânticos consistentes, dark mode menos agressivo.

---

## Fase 2 — Layout & navegação (~2h)

### 2.1 Sidebar mais respirada

`apps/web/src/app/(dashboard)/layout.tsx`:
- `w-64` → `w-72` (288px)
- Cada navlink: `px-4 py-2.5` (em vez de `px-3 py-2`)
- Wrapper de logo: substituir caixa "AM" por SVG (passo 4.1) + nome "afiliado.master" em `font-semibold tracking-tight`

### 2.2 Tabelas com vida

Padrão a aplicar em [`offers/page.tsx`](apps/web/src/app/(dashboard)/offers/page.tsx), [`dispatches/page.tsx`](apps/web/src/app/(dashboard)/dispatches/page.tsx), [`channels/page.tsx`](apps/web/src/app/(dashboard)/channels/page.tsx):

```tsx
<table className="w-full text-sm">
  <thead className="border-b bg-muted/30">
    <tr>
      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">...</th>
    </tr>
  </thead>
  <tbody>
    {rows.map((r, i) => (
      <tr
        key={r.id}
        className={`border-b transition-colors hover:bg-accent/5 ${i % 2 ? 'bg-muted/20' : ''}`}
      >
        ...
      </tr>
    ))}
  </tbody>
</table>
```

Zebra suave (5% accent) + hover de 5% — não compete com o conteúdo, mas dá ritmo.

### 2.3 Forms agrupados em Card

Padrão a aplicar em [`campaigns/page.tsx`](apps/web/src/app/(dashboard)/campaigns/page.tsx), [`channels/page.tsx`](apps/web/src/app/(dashboard)/channels/page.tsx) e telas de cookie:

Substituir blocos `<div><Label/><Input/></div>` soltos por `<Card><CardHeader>title</CardHeader><CardContent class="space-y-4">fields</CardContent></Card>`. Form vira ilha visual em vez de lista flutuante.

### Verificação fase 2
- Tabelas com 30+ linhas viram navegáveis (olho não perde a linha)
- Forms parecem agrupados, não soltos
- Sidebar menos apertada

---

## Fase 3 — Estados (loading, empty, error) (~2h)

### 3.1 Skeleton component

Criar `apps/web/src/components/ui/skeleton.tsx`:
```tsx
export function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className ?? ''}`} />;
}
```

Usar em todas as queries TanStack:
```tsx
{isPending ? (
  <div className="space-y-3">
    {Array.from({ length: 5 }).map((_, i) => (
      <Skeleton key={i} className="h-16 w-full" />
    ))}
  </div>
) : (
  <Table data={data} />
)}
```

### 3.2 EmptyState component

Criar `apps/web/src/components/ui/empty-state.tsx`:
```tsx
import type { LucideIcon } from 'lucide-react';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
```

Aplicar onde lista vier vazia: `/offers`, `/offers/pending`, `/campaigns`, `/dispatches`, `/channels`. Cada um com ícone + texto + CTA pra "como começar".

### 3.3 Spinner em mutations

Botões que disparam `useMutation` ganham loading state visível:

```tsx
<Button disabled={mutation.isPending}>
  {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
  {mutation.isPending ? 'Salvando...' : 'Salvar'}
</Button>
```

### Verificação fase 3
- Refresh em página com lista cheia → skeleton aparece, depois conteúdo
- Lista vazia → ícone + "Nenhuma oferta ainda. Importe via /sources/AMAZON/fetch."
- Click em "Salvar" → spinner inline (sem dúvida se clicou)

---

## Fase 4 — Identidade & polimento (~1-2h)

### 4.1 Logo + favicon

Criar `apps/web/public/logo.svg` simples — duas letras "am" em monospace ou um símbolo geométrico (círculo dividido = "afiliado" + "master"). Usar como `<Image src="/logo.svg" />` na sidebar e em `<head>` como `<link rel="icon" />`.

Sugestão minimalista (SVG inline):
```svg
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <rect width="24" height="24" rx="6" fill="hsl(217 91% 60%)" />
  <path d="M7 17V8h2.5l2.5 6 2.5-6H17v9h-1.5v-6.5L13 17h-2L8.5 10.5V17z" fill="white"/>
</svg>
```

### 4.2 Tipografia de marca

Em `apps/web/src/app/layout.tsx`, trocar import default por:
```tsx
import { Geist, Geist_Mono } from 'next/font/google';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });

// no <html className={`${geist.variable} ${geistMono.variable}`}>
```

E em `globals.css`:
```css
@layer base {
  body { font-family: var(--font-sans), system-ui, sans-serif; }
  code, pre { font-family: var(--font-mono), monospace; }
}
```

Geist é a fonte do Vercel — limpa, profissional, gratuita via `next/font/google`.

### 4.3 Microinterações

Adicionar utilities (já tem `tailwindcss-animate` no plugin):
- Cards na entrada: `className="animate-in fade-in slide-in-from-bottom-2 duration-300"`
- Badges após mudança de estado: `animate-in zoom-in-95 duration-200`
- Tooltip e dropdown menus já vêm com fade do Radix

### Verificação fase 4
- Logo aparece sidebar + aba do browser
- Texto com peso/letterspacing diferente (Geist é distinto)
- Tabela carregada parece "entrar" suave em vez de aparecer estático

---

## Arquivos críticos (mapa)

| O quê | Onde | Fase |
|---|---|---|
| Tokens CSS | `apps/web/src/app/globals.css` | 1 |
| Theme Tailwind | `apps/web/tailwind.config.ts` | 1 |
| Button | `apps/web/src/components/ui/button.tsx` | 1 |
| Input | `apps/web/src/components/ui/input.tsx` | 1 |
| Badge | `apps/web/src/components/ui/badge.tsx` | 1 |
| Sidebar | `apps/web/src/app/(dashboard)/layout.tsx` | 2 |
| Tables | `apps/web/src/app/(dashboard)/{offers,dispatches,channels}/page.tsx` | 2 |
| Forms | `apps/web/src/app/(dashboard)/{campaigns,channels,sources/*/cookie}/page.tsx` | 2 |
| Skeleton | `apps/web/src/components/ui/skeleton.tsx` (criar) | 3 |
| EmptyState | `apps/web/src/components/ui/empty-state.tsx` (criar) | 3 |
| Buttons com mutation | todas as páginas que usam `useMutation` | 3 |
| Logo SVG | `apps/web/public/logo.svg` (criar) | 4 |
| Layout root | `apps/web/src/app/layout.tsx` | 4 |

---

## Estimativa de impacto

| Fase | Tempo | Antes → Depois |
|---|---|---|
| 1 — Fundação | ~2-3h | "Amador" → "Profissional cru" |
| 2 — Layout | ~2h | "Profissional cru" → "Profissional polido" |
| 3 — Estados | ~2h | "Funciona" → "Cuidado com UX" |
| 4 — Identidade | ~1-2h | "Genérico" → "Tem cara de produto" |

Total: ~8h de execução. Pode ir incrementalmente — fase 1 sozinha já transforma a percepção.

---

## Próximas ações

Confirma se quer:
1. Que eu execute **fase 1 completa** agora (mudanças em 5 arquivos, sem visual ainda no browser — só rebuilds)
2. Ou que executemos **uma fase por vez** com você validando no browser entre cada uma
3. Ou alterações específicas (você cita "essa parte aqui tá feia, conserta").

Recomendo opção 2 — fase 1 já dá pra você ver no `yarn dev:web` se a paleta nova faz sentido pra marca antes de aplicar nas tabelas/forms.
