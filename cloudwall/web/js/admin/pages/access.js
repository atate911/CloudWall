// Who can see it: two doors. The wall's, open to anyone who can reach it or only to those with its
// private link (shown here, ready to copy); and this board's, locked by the owner's password. How
// CloudWall is reached (its name, what it listens on) is set once, under a shade.
import { el, esc, S, call, toast, value, button } from "../core.js";
import { icon } from "../icons.js";
import { head, pageTroubles, copyable } from "../parts.js";
import { text, cards, stepper, shade, group } from "../controls.js";

/** The wall's address with a private link's key in it, wherever this board is being reached. */
const viewerLink = (key) => `${location.origin}${location.pathname.replace(/\/admin\/?$/, "").replace(/\/k\/[^/]+$/, "")}/k/${key}/`;

function wallDoor() {
  const on = S.overview.private_link;
  const door = el(`<section class="door ${on ? "locked" : "open"}">
    <div class="door-ico">${icon(on ? "lock" : "screens")}</div>
    <h2>The wall</h2>
    <b class="door-state">${on ? "Only with the private link" : "Anyone who can reach it"}</b>
    <p>${on ? "Screens open it at its private link: the key in the address works as a password. Anyone without it sees nothing." : "Anyone who can reach this server sees the wall. A private link puts a key in its address, so only screens you've given it to can open it."}</p>
    <div class="door-link"></div>
    <div class="door-acts"></div>
  </section>`);
  const acts = door.querySelector(".door-acts"), link = door.querySelector(".door-link");
  if (on) {
    acts.append(button("Show the link", async () => {
      const got = await call("private-link", { action: "show" });
      link.replaceChildren(got.key ? copyable(viewerLink(got.key), { said: "The private link is copied", cls: "ticket" }) : el(`<p class="dim">No link is set</p>`));
    }, "small quiet"));
  }
  acts.append(button(on ? "Make a new link" : "Make a private link", async () => {
    if (on && !confirm("Every screen will need the new link: the old one stops working after the restart. Make it?")) return;
    const got = await call("private-link", { action: "new" });
    toast(got.said);
    if (got.key) link.replaceChildren(copyable(viewerLink(got.key), { said: "The new link: give it to each screen after the restart", cls: "ticket" }));
  }, on ? "small quiet" : "small"));
  if (on) acts.append(button("Open it to everyone", async () => {
    if (!confirm("Anyone who can reach this server will see the wall. Take the private link away?")) return;
    toast((await call("private-link", { action: "off" })).said);
  }, "small quiet danger"));
  return door;
}

function boardDoor() {
  const set = S.who.owner_set;
  const door = el(`<section class="door ${set ? "locked" : "open warn"}">
    <div class="door-ico">${icon(set ? "key" : "lock")}</div>
    <h2>This control board</h2>
    <b class="door-state">${set ? "Locked by your password" : "Only from the machine itself"}</b>
    <p>${set ? `Changes need the owner's password; ${S.who.local ? "you're on the machine itself now" : "you're signed in"}. Five wrong tries in five minutes and it stops listening for a while.` : "Until the owner has a password, CloudWall can be changed only from a browser on its own machine. Set one to use this board from anywhere."}</p>
    <button class="btn small ${set ? "quiet" : ""}" data-change>${set ? "Change the password" : "Set a password"}</button>
    <form class="pw" hidden>
      <label>New password <span class="dim">at least 10 characters</span><input type="password" autocomplete="new-password" minlength="10" required></label>
      <label>Again<input type="password" autocomplete="new-password" minlength="10" required></label>
      <button class="btn small">Save the password</button>
    </form>
  </section>`);
  const form = door.querySelector("form");
  door.querySelector("[data-change]").onclick = (e) => { form.hidden = false; e.target.hidden = true; form.querySelector("input").focus(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const [a, b] = form.querySelectorAll("input");
    if (a.value !== b.value) return toast("The two passwords don't match", true);
    try { toast((await call("password", { password: a.value })).said); S.who = await call("whoami"); form.hidden = true; }
    catch (err) { if (err.message !== "signed out") toast(err.message, true); }
  };
  return door;
}

export default {
  id: "access", title: "Who can see it", icon: "access",
  live() { return S.overview?.private_link ? "private link" : "open to its network"; },
  async draw(page) {
    page.append(head("Who can see it", "Who can open the wall, and who can change CloudWall."));
    const t = pageTroubles("access");
    if (t) page.append(t);
    const doors = el(`<div class="doors"></div>`);
    doors.append(wallDoor(), boardDoor());
    page.append(doors);

    const host = value("server", "host"), port = value("server", "port"), addr = value("server", "address");
    page.append(group("How it's reached", `${addr ? `At <b>${esc(addr)}</b>${host === "127.0.0.1" ? ", through Caddy" : ""}` : "By its address"}; CloudWall itself listens ${host === "127.0.0.1" ? "only on this machine" : "on every network"}, port ${esc(port)}.`, [
      text("server", "address", { label: "Its name on the internet", empty: "None: reached by its address", help: "The name Caddy serves it at (cloudwall.example.com). Only used for the links CloudWall prints." }),
    ]));
    page.append(shade("Listening", () => `${host === "127.0.0.1" ? "this machine only" : "every network"}, port ${port}`, [
      cards("server", "host", { label: "Who can connect to it directly", options: [
        { value: "127.0.0.1", title: "Only this machine", body: "Behind Caddy or a tunnel, which pass on what they let through. The safe choice on a server on the internet.", icon: "lock" },
        { value: "0.0.0.0", title: "Every network", body: "Any device that can reach this machine, on its port. For a server at home on your own network.", icon: "screens" },
      ] }),
      stepper("server", "port", { label: "Port", min: 1, max: 65535, step: 1, says: (v) => `Screens on the network open it at port ${v}.` }),
    ]));
  },
};
