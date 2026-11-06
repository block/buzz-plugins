import type { Context } from "@buzz/author";
import { pluginsCapability } from "./install";
import { styles } from "./styles";
import { createViews, PAGE_ID } from "./view";

export const inject = ["react", "pages", "navigation", "host"];

// Paints with currentColor so Buzz draws it in the tab's own text colour. Hosts that
// still show it as a plain image fall back to the greys set in the style block.
const ICON =
  "data:image/svg+xml;base64," +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"><style>svg{color:#525252}@media (prefers-color-scheme:dark){svg{color:#c7c7c7}}</style><path d="M6.331 8h11.339a2 2 0 0 1 1.977 2.304l-1.255 8.152a3 3 0 0 1 -2.966 2.544h-6.852a3 3 0 0 1 -2.965 -2.544l-1.255 -8.152a2 2 0 0 1 1.977 -2.304"/><path d="M9 11v-5a3 3 0 0 1 6 0v5"/></svg>',
  );

export function apply(ctx: Context) {
  const style = document.createElement("style");
  style.dataset.plugin = "xyz.block.community-marketplace";
  style.textContent = styles;
  document.head.append(style);
  ctx.effect(() => () => style.remove());

  const MarketplacePage = createViews(ctx, pluginsCapability(ctx));
  ctx.pages.register({
    id: PAGE_ID,
    title: "Community Marketplace",
    layout: "workspace",
    primary: true,
    placement: "topbar",
    icon: ICON,
    route: {
      version: 1,
      validate: (params) =>
        !!params &&
        typeof params === "object" &&
        !Array.isArray(params) &&
        typeof (params as { slug?: unknown }).slug === "string" &&
        /^[a-z0-9-]{1,120}$/.test((params as { slug: string }).slug),
    },
    component: MarketplacePage,
  });
}
