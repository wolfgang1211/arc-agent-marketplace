import Image from "next/image";

export function BrandLogo({ compact = false }) {
  return (
    <span
      className={`brand-signature${compact ? " brand-signature-compact" : ""}`}
      role="img"
      aria-label="AlphaBoard Agents"
    >
      <Image
        className="brand-symbol"
        src="/brand/alphaboard-agents-mark.png"
        alt=""
        width={compact ? 32 : 38}
        height={compact ? 32 : 38}
        aria-hidden="true"
        priority
      />
      <span className="brand-type">
        <span className="brand-wordmark">
          <strong>Alpha</strong><span>Board</span>
        </span>
        <span className="brand-descriptor">Autonomous Agents</span>
      </span>
    </span>
  );
}
