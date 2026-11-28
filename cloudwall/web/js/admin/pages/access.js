// Access page: who can see the wall (anyone, or only with its private link), the board's password,
// and how CloudWall is reached.
import { el, S, call, toast, value, button, loadSettings, emit, TITLES } from "../core.js";
import { head, pageTroubles, copyable } from "../parts.js";
import { text, cards, stepper, group, line, advanced } from "../controls.js";

// the key is a secret the board never reads back, so mark it saved by hand
const changed = async () => { S.secretsSaved.add("server.key"); await loadSettings(); };

/** The wall's address with the private link's key, relative to wherever this board is reached. */
const viewerLink = (key) => `${location.origin}${location.pathname.replace(/\/admin\/?$/, "").replace(/\/k\/[^/]+$/, "")}/k/${key}/`;

function privateLink() {
  const on = S.overview.private_link;
  const show = el(`<div class="link-slot"></div>`);
  const acts = [];
  if (on) acts.push(button("Show the link", async () => {
    const got = await call("private-link", { action: "show" });
    show.replaceChildren(got.key ? copyable(viewerLink(got.key), { said: "The private link is copied", cls: "ticket" }) : el(`<p class="dim">No link is set</p>`));
  }, "small quiet"));
  acts.push(button(on ? "Make a new link" : "Make a private link", async () => {
    if (on && !confirm("Every screen will need the new link: the old one stops working after the restart. Make it?")) return;
    const got = await call("private-link", { action: "new" });
    toast(got.said);
    await changed();
    if (got.key) show.replaceChildren(copyable(viewerLink(got.key), { said: "The new link is copied: give it to each screen after the restart", cls: "ticket" }));
  }, on ? "small quiet" : "small"));
  if (on) acts.push(button("Turn it off", async () => {
    if (!confirm("Anyone who can reach this server will see the wall. Turn the private link off?")) return;
    toast((await call("private-link", { action: "off" })).said);
    await changed();
    emit("page");
  }, "small quiet danger"));
  const r = line("Private link", `<span class="line-val"><span class="dot ${on ? "ok" : ""}"></span> ${on ? "On: screens open the wall at its private link" : "Off: anyone who can reach this server sees the wall"}</span>`, acts);
  r.querySelector(".line-body").append(show);
  r.dataset.setting = "server.key";
  return r;
}

function password() {
  const set = S.who.owner_set;
  const form = el(`<form class="pw" hidden>
      <label>New password <span class="dim">at least 10 characters</span><input type="password" autocomplete="new-password" minlength="10" required></label>
      <label>Again<input type="password" autocomplete="new-password" minlength="10" required></label>
      <button class="btn small">Save the password</button></form>`);
  const change = el(`<button class="btn small ${set ? "quiet" : ""}" type="button">${set ? "Change the password" : "Set a password"}</button>`);
  change.onclick = () => { form.hidden = false; change.hidden = true; form.querySelector("input").focus(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const [a, b] = form.querySelectorAll("input");
    if (a.value !== b.value) return toast("The two passwords don't match", true);
    try { toast((await call("password", { password: a.value })).said); S.who = await call("whoami"); form.hidden = true; change.hidden = false; }
    catch (err) { if (err.message !== "signed out") toast(err.message, true); }
  };
  const r = line("Owner password", `<span class="line-val"><span class="dot ${set ? "ok" : "warn"}"></span> ${set ? "Set: changes need it" : "Not set: CloudWall can only be changed from its own machine"}</span>
    <span class="dim small">${set ? "Five wrong tries in five minutes and sign-in waits a while." : "Set one to use this board from anywhere."}</span>`, [change]);
  r.querySelector(".line-body").append(form);
  return r;
}

export default {
  id: "access", get title() { return TITLES.access; }, icon: "access",
  async draw(page) {
    page.append(head(TITLES.access, "Who can open the wall, who can change CloudWall, and how it's reached."));
    const t = pageTroubles("access");
    if (t) page.append(t);

    page.append(group("Wall", "Who can open the screens", [privateLink()]));
    page.append(group("Control board", "Who can change CloudWall", [password()]));

    page.append(group("Network", "", [
      text("server", "address", { label: "Domain name", empty: "None: reached by its address", help: "The name Caddy serves it at (cloudwall.example.com). Only used for the links CloudWall prints." }),
      advanced(() => `${value("server", "host") === "127.0.0.1" ? "this machine only" : "every network"}, port ${value("server", "port")}`, [
        cards("server", "host", { label: "Listen on", options: [
          { value: "127.0.0.1", title: "This machine only", body: "Behind Caddy or a tunnel. The safe choice for a server on the internet.", icon: "lock" },
          { value: "0.0.0.0", title: "Every network", body: "Any device that can reach this machine on its port. For a server at home.", icon: "screens" },
        ] }),
        stepper("server", "port", { label: "Port", min: 1, max: 65535, step: 1, says: (v) => `Screens on the network open it at port ${v}.` }),
      ]),
    ]));
  },
};
