/** Englisches Wörterbuch (Schlüssel = deutscher Text) */
import { settings } from "./en/settings";
import { app } from "./en/app";
import { playerChat } from "./en/player-chat";

export const EN: Record<string, string> = { ...settings, ...app, ...playerChat };
