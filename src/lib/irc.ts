/** Minimaler Twitch-IRC-Client über WebSocket (IRCv3 Tags). */

export interface IrcMessage {
  raw: string;
  tags: Record<string, string>;
  prefix: string;
  nick: string;
  command: string;
  params: string[];
}

function unescapeTag(v: string): string {
  return v.replace(/\\(.)/g, (_, c) =>
    c === "s" ? " " : c === ":" ? ";" : c === "r" ? "\r" : c === "n" ? "\n" : c,
  );
}

export function parseIrc(line: string): IrcMessage | null {
  let pos = 0;
  const msg: IrcMessage = { raw: line, tags: {}, prefix: "", nick: "", command: "", params: [] };
  if (line.startsWith("@")) {
    const end = line.indexOf(" ");
    for (const pair of line.slice(1, end).split(";")) {
      const eq = pair.indexOf("=");
      if (eq === -1) msg.tags[pair] = "";
      else msg.tags[pair.slice(0, eq)] = unescapeTag(pair.slice(eq + 1));
    }
    pos = end + 1;
  }
  while (line[pos] === " ") pos++;
  if (line[pos] === ":") {
    const end = line.indexOf(" ", pos);
    msg.prefix = line.slice(pos + 1, end);
    msg.nick = msg.prefix.split("!")[0];
    pos = end + 1;
  }
  const rest = line.slice(pos);
  const trailingIdx = rest.indexOf(" :");
  const head = trailingIdx === -1 ? rest : rest.slice(0, trailingIdx);
  const parts = head.split(" ").filter(Boolean);
  msg.command = parts.shift() ?? "";
  msg.params = parts;
  if (trailingIdx !== -1) msg.params.push(rest.slice(trailingIdx + 2));
  if (!msg.command) return null;
  return msg;
}

type Handler = (m: IrcMessage) => void;

export class TwitchIrc {
  private ws: WebSocket | null = null;
  private channels = new Set<string>();
  private handlers = new Set<Handler>();
  private stateHandlers = new Set<(connected: boolean) => void>();
  private creds: { login: string; token: string } | null = null;
  private retry = 0;
  private closedByUser = false;
  private pingTimer: number | undefined;
  connected = false;

  get login() {
    return this.creds?.login ?? null;
  }

  get canSend() {
    return !!this.creds && this.connected;
  }

  onMessage(h: Handler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  onState(h: (connected: boolean) => void) {
    this.stateHandlers.add(h);
    return () => this.stateHandlers.delete(h);
  }

  setCredentials(creds: { login: string; token: string } | null) {
    const changed = creds?.token !== this.creds?.token;
    this.creds = creds;
    if (changed && this.ws) this.reconnect();
  }

  connect() {
    this.closedByUser = false;
    const ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      if (this.creds) {
        ws.send(`PASS oauth:${this.creds.token}`);
        ws.send(`NICK ${this.creds.login}`);
      } else {
        ws.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`);
      }
    };
    ws.onmessage = (ev) => {
      for (const line of String(ev.data).split("\r\n")) {
        if (!line) continue;
        const m = parseIrc(line);
        if (!m) continue;
        if (m.command === "PING") {
          ws.send(`PONG :${m.params[0] ?? "tmi.twitch.tv"}`);
          continue;
        }
        if (m.command === "001") {
          this.setConnected(true);
          this.joinAll();
        }
        if (m.command === "RECONNECT") {
          this.reconnect();
          return;
        }
        this.handlers.forEach((h) => h(m));
      }
    };
    ws.onclose = () => {
      this.setConnected(false);
      if (this.ws !== ws || this.closedByUser) return;
      const delay = Math.min(30000, 1000 * 2 ** this.retry++);
      window.setTimeout(() => this.ws === ws && this.connect(), delay);
    };
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("PING :nativ");
    }, 60000);
  }

  private setConnected(v: boolean) {
    this.connected = v;
    this.stateHandlers.forEach((h) => h(v));
  }

  private reconnect() {
    const old = this.ws;
    this.ws = null;
    old?.close();
    this.connect();
  }

  private joinAll() {
    const list = [...this.channels];
    for (let i = 0; i < list.length; i += 20) {
      this.ws?.send(`JOIN ${list.slice(i, i + 20).map((c) => `#${c}`).join(",")}`);
    }
  }

  join(channel: string) {
    channel = channel.toLowerCase();
    if (this.channels.has(channel)) return;
    this.channels.add(channel);
    if (this.connected) this.ws?.send(`JOIN #${channel}`);
  }

  part(channel: string) {
    channel = channel.toLowerCase();
    if (!this.channels.delete(channel)) return;
    if (this.connected) this.ws?.send(`PART #${channel}`);
  }

  send(channel: string, text: string, replyTo?: string) {
    if (!this.canSend) return false;
    const tags = replyTo ? `@reply-parent-msg-id=${replyTo} ` : "";
    this.ws?.send(`${tags}PRIVMSG #${channel} :${text.replace(/[\r\n]+/g, " ")}`);
    return true;
  }

  close() {
    this.closedByUser = true;
    window.clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }
}

export const irc = new TwitchIrc();
