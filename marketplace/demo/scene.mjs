// Browse the index, inspect a low and a high access listing, then add one through Buzz's own review.
// Record with --mocks demo/mocks.mjs.
export default async function ({ page, demo }) {
  const card = (name) => page.locator(".bm-card").filter({ hasText: name }).first();
  const sort = (name) => page.getByRole("group", { name: "Sort" }).getByRole("button", { name, exact: true });
  const back = page.getByRole("button", { name: "← All plugins" });
  await demo.captionPosition("bottom");
  await demo.title("Community Marketplace", "Open Buzz plugins from public repositories");

  demo.chapter("Browse");
  await demo.openPage("Community Marketplace");
  await demo.caption("Every card shows the author, stars, last update and whether anyone reviewed it", 2600);
  demo.poster();
  await demo.hover(card("Counter"), 700);
  await demo.hideCaption();

  demo.chapter("Sort");
  await demo.click(sort("Most stars"), { after: 900 });
  await demo.click(sort("A–Z"), { after: 900 });
  await demo.click(sort("Recently updated"), { after: 700 });

  demo.chapter("Search");
  await demo.type(page.getByRole("searchbox", { name: "Search plugins" }), "counter", { delay: 70 });
  await demo.pause(900);
  await page.getByRole("searchbox", { name: "Search plugins" }).fill("");
  await demo.pause(500);

  demo.chapter("A low access plugin");
  await demo.click(card("Projects"), { after: 1000 });
  await demo.caption("The audit sits above Add to Buzz. This one asks for nothing beyond Buzz", 2600);
  await demo.hover(page.getByLabel("Audit"), 900);
  await demo.hideCaption();
  await demo.click(back, { after: 700 });

  demo.chapter("A flagged plugin");
  await demo.click(card("Agent Toolbox"), { after: 1000 });
  await demo.caption("High access, scan flags, and not cleared by a maintainer", 2800);
  await demo.hover(page.getByLabel("Audit"), 1200);
  await demo.hover(page.locator(".bm-aside-card:has(h3:text-is(\"Can access\"))"), 1200);
  await demo.hideCaption();
  await demo.click(back, { after: 700 });

  demo.chapter("Add to Buzz");
  await demo.click(card("Projects"), { after: 900 });
  await demo.caption("Add to Buzz opens Buzz's own install review at the exact commit", 1800);
  await demo.click(page.getByRole("button", { name: "Add to Buzz" }), { after: 1400 });
  const dialog = page.getByRole("dialog", { name: /Add a plugin|Review .*access/i });
  await demo.hideCaption();
  await demo.click(dialog.getByRole("button", { name: "Find" }), { after: 1800 });

  demo.chapter("Review and install");
  await demo.caption("Buzz shows what it can do and checks the commit", 2200);
  await demo.hover(dialog.getByText("matches the requested commit"), 800);
  await demo.click(dialog.getByRole("button", { name: "Install plugin" }), { after: 1600 });
  await demo.hideCaption();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await demo.click(settings.getByRole("button", { name: /^Close/ }).first(), { after: 800 });
  await demo.caption("The marketplace confirms it and lists any setup", 1800);
  await demo.hover(page.getByRole("status", { name: "Added to Buzz" }), 900);
  await demo.hideCaption();

  await demo.pause(600);
}
