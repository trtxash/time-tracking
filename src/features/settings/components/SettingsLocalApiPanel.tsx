import { Cable, Dices, Eye, EyeOff } from "lucide-react";
import type { SyntheticEvent } from "react";
import { useEffect, useState } from "react";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import { UI_TEXT } from "../../../shared/copy/uiText.ts";
import { buildLocalApiEnabledChange, createLocalApiToken } from "../services/localApiTokenService.ts";

type SettingsLocalApiPanelProps = {
  enabled: boolean;
  port: number;
  token: string;
  onEnabledChange: (nextChecked: boolean) => void;
  onPortChange: (nextPort: number) => void;
  onTokenChange: (nextToken: string) => void;
};

const LOCAL_API_PORT_MIN = 1024;
const LOCAL_API_PORT_MAX = 65535;
const LOCAL_API_ENDPOINT_PREFIX = "ws://127.0.0.1:";
const PORT_DRAFT_PATTERN = /^\d{0,5}$/;

function normalizePort(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return "";
  if (parsed < LOCAL_API_PORT_MIN || parsed > LOCAL_API_PORT_MAX) return "";
  return String(parsed);
}

export default function SettingsLocalApiPanel({
  enabled,
  port,
  token,
  onEnabledChange,
  onPortChange,
  onTokenChange,
}: SettingsLocalApiPanelProps) {
  const [portDraft, setPortDraft] = useState(String(port));
  const [tokenVisible, setTokenVisible] = useState(false);

  useEffect(() => {
    setPortDraft(String(port));
  }, [port]);

  const handleEnabledChange = (nextChecked: boolean) => {
    const change = buildLocalApiEnabledChange(nextChecked, token);
    if (change.token !== null && change.token !== token) {
      onTokenChange(change.token);
    }
    onEnabledChange(change.enabled);
  };
  const handleGenerateToken = () => {
    onTokenChange(createLocalApiToken());
    setTokenVisible(true);
  };
  const endpointDraft = `${LOCAL_API_ENDPOINT_PREFIX}${portDraft}`;
  const handleEndpointChange = (nextValue: string) => {
    if (!nextValue.startsWith(LOCAL_API_ENDPOINT_PREFIX)) return;
    const nextDraft = nextValue.slice(LOCAL_API_ENDPOINT_PREFIX.length);
    if (!PORT_DRAFT_PATTERN.test(nextDraft)) return;
    setPortDraft(nextDraft);
  };
  const keepEndpointPrefixLocked = (event: SyntheticEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    if (start >= LOCAL_API_ENDPOINT_PREFIX.length && end >= LOCAL_API_ENDPOINT_PREFIX.length) return;
    event.preventDefault();
    input.setSelectionRange(LOCAL_API_ENDPOINT_PREFIX.length, input.value.length);
  };

  return (
    <section className="qp-panel p-5 md:p-6">
      <div className="flex items-center gap-2.5 border-b border-[var(--qp-border-subtle)] pb-2">
        <Cable size={16} className="text-[var(--qp-accent-default)]" />
        <h2 className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.settings.localApiTitle}</h2>
      </div>

      <div className="mt-5 space-y-5">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--qp-text-tertiary)]">
            {UI_TEXT.settings.localApiEnabledLabel}
          </label>
          <div className="mt-2 flex items-start justify-between gap-4">
            <p className="text-sm leading-relaxed text-[var(--qp-text-secondary)]">
              {UI_TEXT.settings.localApiEnabledHint}
            </p>
            <QuietSwitch
              checked={enabled}
              onChange={handleEnabledChange}
              ariaLabel={UI_TEXT.accessibility.settings.toggleLocalApi}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="settings-local-api-port"
            className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--qp-text-tertiary)]"
          >
            {UI_TEXT.settings.localApiPortLabel}
          </label>
          <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
            <div className="min-w-0">
              <p className="text-sm leading-relaxed text-[var(--qp-text-secondary)]">
                {UI_TEXT.settings.localApiPortHint}
              </p>
            </div>
            <input
              id="settings-local-api-port"
              type="text"
              value={endpointDraft}
              onBeforeInput={keepEndpointPrefixLocked}
              onKeyDown={(event) => {
                const input = event.currentTarget;
                const start = input.selectionStart ?? input.value.length;
                const end = input.selectionEnd ?? input.value.length;
                const editsPrefix = start < LOCAL_API_ENDPOINT_PREFIX.length
                  || (event.key === "Backspace" && start <= LOCAL_API_ENDPOINT_PREFIX.length && start === end);
                if (editsPrefix) {
                  event.preventDefault();
                  input.setSelectionRange(LOCAL_API_ENDPOINT_PREFIX.length, input.value.length);
                }
              }}
              onChange={(event) => handleEndpointChange(event.target.value)}
              onBlur={() => {
                const normalized = normalizePort(portDraft);
                if (normalized) {
                  setPortDraft(normalized);
                  const nextPort = Number(normalized);
                  if (nextPort !== port) {
                    onPortChange(nextPort);
                  }
                } else {
                  setPortDraft(String(port));
                }
              }}
              className="qp-input settings-local-api-address-input h-[34px]"
              disabled={!enabled}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="settings-local-api-token"
            className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--qp-text-tertiary)]"
          >
            {UI_TEXT.settings.localApiTokenLabel}
          </label>
          <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
            <p className="text-sm leading-relaxed text-[var(--qp-text-secondary)]">
              {UI_TEXT.settings.localApiTokenHint}
            </p>
            <div className="relative w-full md:w-[420px]">
              <input
                id="settings-local-api-token"
                type={tokenVisible ? "text" : "password"}
                value={token}
                onChange={(event) => onTokenChange(event.target.value)}
                className="qp-input h-[34px] w-full pr-18"
                disabled={!enabled}
                autoComplete="off"
              />
              <button
                type="button"
                className="settings-token-action-button settings-token-random-button"
                disabled={!enabled}
                aria-label={UI_TEXT.accessibility.settings.generateLocalApiToken}
                onClick={handleGenerateToken}
              >
                <Dices size={14} />
              </button>
              <button
                type="button"
                className="settings-token-action-button settings-token-visibility-button"
                disabled={!enabled}
                aria-label={tokenVisible ? UI_TEXT.accessibility.settings.hideLocalApiToken : UI_TEXT.accessibility.settings.showLocalApiToken}
                onClick={() => setTokenVisible((current) => !current)}
              >
                {tokenVisible ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
