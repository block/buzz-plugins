import type { Context } from "@buzz/author";

export const inject = ["react", "pages"];

export function apply(ctx: Context) {
  const React = ctx.react;

  function MyPage() {
    const [count, setCount] = React.useState(0);
    return (
      <section style={{ padding: "var(--space-8)", fontFamily: "var(--font-sans)", color: "var(--text-standard)" }}>
        <h1>My plugin</h1>
        <p>Edit src/index.tsx, run the build, and commit manifest.json and plugin.js.</p>
        <button type="button" onClick={() => setCount(count + 1)}>
          Clicked {count} {count === 1 ? "time" : "times"}
        </button>
      </section>
    );
  }

  ctx.pages.register({ id: "main", title: "My plugin", primary: true, component: MyPage });
}
