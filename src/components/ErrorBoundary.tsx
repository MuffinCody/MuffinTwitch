import { Component, type ReactNode } from "react";
import { api } from "../lib/api";
import { t } from "../lib/i18n";

interface Props {
  name: string;
  children: ReactNode;
  /** Kompakte Anzeige (z. B. in einer Player-Kachel) */
  compact?: boolean;
  style?: React.CSSProperties;
}

/**
 * Fängt Render-Fehler ab, damit nicht die ganze Oberfläche verschwindet,
 * und protokolliert sie in nativ.log.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    api.logError(`[${this.props.name}] ${error.stack ?? error.message}\n${info.componentStack ?? ""}`).catch(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={this.props.compact ? "boundary compact" : "boundary"} style={this.props.style}>
        <b>{t("Hier ist etwas schiefgelaufen.")}</b>
        <small>{this.state.error.message}</small>
        <button onClick={() => this.setState({ error: null })}>{t("Erneut versuchen")}</button>
      </div>
    );
  }
}
