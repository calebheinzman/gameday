// Tiny element builder. Text goes through text nodes, never innerHTML, so
// league and team names from Sleeper can't inject markup.
//
//   h("li", { class: "row", dataset: { key: "4046" } }, "Name", h("span", {}, "12.4"))

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (name === "class") el.className = value;
    else if (name === "dataset") Object.assign(el.dataset, value);
    else if (name.startsWith("on") && typeof value === "function") el.addEventListener(name.slice(2), value);
    else if (value === true) el.setAttribute(name, "");
    else el.setAttribute(name, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}
