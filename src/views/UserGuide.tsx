import mathcoLogo from '/assets/mathco-logo.svg';

const BASE = import.meta.env.BASE_URL;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '0.5px solid var(--border-hairline)', paddingTop: 28, marginTop: 36 }}>
      <h2 style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 16 }}>{title}</h2>
      {children}
    </div>
  );
}

function MetricRow({ term, def }: { term: string; def: string }) {
  return (
    <tr>
      <td style={{ padding: '7px 20px 7px 0', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', verticalAlign: 'top', fontSize: 13 }}>{term}</td>
      <td style={{ padding: '7px 0', color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>{def}</td>
    </tr>
  );
}

interface ViewCardProps {
  title: string;
  purpose: string;
  audience: string[];
  screenshot: string;
  audienceNote?: string;
}

const audienceColors: Record<string, { bg: string; text: string }> = {
  LT:      { bg: '#ede9fe', text: '#5b21b6' },
  Sellers: { bg: '#dcfce7', text: '#166534' },
  JD:      { bg: '#fef3c7', text: '#92400e' },
};

function ViewCard({ title, purpose, audience, screenshot, audienceNote }: ViewCardProps) {
  return (
    <div style={{ marginBottom: 48 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>{title}</div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 720, marginBottom: 10 }}>{purpose}</p>
        {audienceNote && (
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5, maxWidth: 720, marginBottom: 10 }}>{audienceNote}</p>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          {audience.map((a) => (
            <span
              key={a}
              style={{
                fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4,
                background: audienceColors[a]?.bg ?? '#f3f4f6',
                color: audienceColors[a]?.text ?? '#374151',
              }}
            >
              {a}
            </span>
          ))}
        </div>
      </div>
      <img
        src={`${BASE}assets/guide/${screenshot}`}
        alt={`${title} screenshot`}
        style={{ width: '100%', border: '0.5px solid var(--border-hairline)', borderRadius: 8, display: 'block' }}
      />
    </div>
  );
}

export function UserGuide() {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 64 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <img src={mathcoLogo} alt="MathCo" style={{ height: 24, width: 'auto' }} />
        <h1 style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' }}>Sales dashboard — user guide</h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 24 }}>May 2026 &nbsp;·&nbsp; Questions: <a href="mailto:jaideep@mathco.com" style={{ color: 'var(--accent)' }}>jaideep@mathco.com</a></p>

      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, maxWidth: 720 }}>
        This dashboard gives the MathCo growth team a live, weekly view of pipeline health, deal activity, and revenue progress.
        Data syncs from Monday.com. The version chip in the top-right shows the data date — check it before drawing conclusions.
      </p>

      <Section title="Metrics and definitions">
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            <MetricRow term="Weighted pipeline" def="Stage probability × deal size × quarter weighting. S1–S4 floored at $100K. The primary health metric — not raw deal count or total TCV." />
            <MetricRow term="Booked" def="Revenue from won deals, recognized into the current quarter by start date and duration." />
            <MetricRow term="Committed" def="S5 (Commercial Proposal) and S6 (Contracting) deals at full size. High-confidence but not yet won." />
            <MetricRow term="Forecast" def="Booked + Committed. Best-case revenue floor for the quarter." />
            <MetricRow term="S3+ %" def="Share of weighted pipeline from S3 (Capability) and above. Quality signal: ≥65% healthy, 50–65% watch, <50% at-risk." />
            <MetricRow term="Stale" def="Active deals with no stage movement past the threshold — S1: 45d, S2: 30d, S3/S4: 21d, S5/S6: 14d." />
            <MetricRow term="No NMD on committed" def="S5/S6 deals with no next meeting date set, or one that has already passed. Highest-risk committed deals." />
            <MetricRow term="Coverage" def="Weighted pipeline ÷ target. Team is healthy at ≥1.5×." />
          </tbody>
        </table>
      </Section>

      <Section title="Views">
        <ViewCard
          title="Pipeline health"
          purpose="The primary team health screen. Shows weighted pipeline, booked, committed, S3+%, and stale count per vertical with a team total row. Click any row to expand deal-level detail and manage weekly action items — deals you tag get auto-verified when a stage advances or a new NMD is set."
          audienceNote="Use the action items panel (expand any row) to log deal-specific follow-ups. Items tagged to a deal are automatically marked done when the deal stage advances or NMD is updated."
          audience={['LT', 'Sellers', 'JD']}
          screenshot="vertical-performance.png"
        />
        <ViewCard
          title="Deal movement"
          purpose="Tracks funnel shape and week-over-week movement — how many deals advanced, stalled, were added, or were lost vs the prior week. Use this to see whether pipeline is building or eroding, and to surface individual deal movements before the weekly review."
          audience={['JD', 'Sellers']}
          screenshot="weekly-scorecard.png"
        />
        <ViewCard
          title="Intro activity"
          purpose="Tracks intro and connect meeting cadence over time, by seller and overall. Use this to monitor whether the team is generating enough top-of-funnel activity to sustain future pipeline. The dashed line is the weekly target — bars below it indicate a generation gap. Select a seller from the dropdown to drill into individual activity."
          audience={['LT', 'JD']}
          screenshot="call-trends.png"
        />
        <ViewCard
          title="Operating metrics"
          purpose="A rolling 20-week view of operating metrics — weighted pipeline, new logos closed, late-stage deal count, intro-to-qual conversion rate, and days since last win. Use this to spot directional trends not visible in a single-week snapshot. The manual inputs section lets JD log key levers like co-founder intros and in-person connects."
          audience={['LT', 'JD']}
          screenshot="weekly-operating.png"
        />
        <ViewCard
          title="Quarter trends"
          purpose="The leadership review view. KPI cards (forecast, booked, committed, weighted pipeline) plus a trend chart tracking all four metrics week over week since the quarter started. The table below breaks weighted pipeline by vertical across all weekly snapshots — useful for identifying which verticals are building and which are eroding."
          audience={['LT', 'JD']}
          screenshot="lt-trends.png"
        />
      </Section>

      <div style={{ borderTop: '0.5px solid var(--border-hairline)', paddingTop: 20, marginTop: 36 }}>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          Data syncs weekly from Monday.com. Access issues or questions — <a href="mailto:jaideep@mathco.com" style={{ color: 'var(--accent)' }}>jaideep@mathco.com</a>
        </p>
      </div>
    </div>
  );
}
