// Metric reference — definitions, assumptions, and data source notes for the dashboard.

interface Section {
  id: string;
  title: string;
}

const SECTIONS: Section[] = [
  { id: 'core', title: 'Core metrics' },
  { id: 'pacing', title: 'Quarter pacing' },
  { id: 'ev', title: 'Empirical EV (weighted pipeline)' },
  { id: 'risk', title: 'Risk signals' },
  { id: 'data', title: 'Data source and refresh' },
  { id: 'limits', title: 'Known limitations' },
];

function Anchor({ id }: { id: string }) {
  return <span id={id} style={{ position: 'absolute', marginTop: -72 }} />;
}

function SectionHead({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative' }}>
      <Anchor id={id} />
      <h2 style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 12 }}>
        {children}
      </h2>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--text-secondary)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        display: 'block',
        marginBottom: 2,
      }}
    >
      {children}
    </span>
  );
}

interface DefRowProps {
  term: string;
  children: React.ReactNode;
  note?: string;
  warn?: boolean;
}

function DefRow({ term, children, note, warn }: DefRowProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '180px 1fr',
        gap: '0 24px',
        padding: '10px 0',
        borderBottom: '0.5px solid var(--border-hairline)',
        alignItems: 'start',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', paddingTop: 1 }}>
        {term}
      </div>
      <div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          {children}
        </div>
        {note && (
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              color: warn ? 'var(--status-amber-text)' : 'var(--text-tertiary)',
              background: warn ? 'var(--status-amber-bg)' : undefined,
              borderRadius: warn ? 'var(--radius-sm)' : undefined,
              padding: warn ? '2px 6px' : undefined,
              display: 'inline-block',
            }}
          >
            {note}
          </div>
        )}
      </div>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>
          {headers.map((h) => (
            <th
              key={h}
              style={{
                textAlign: 'left',
                fontWeight: 500,
                fontSize: 12,
                color: 'var(--text-secondary)',
                padding: '6px 12px 6px 0',
                borderBottom: '0.5px solid var(--border-emphasis)',
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
            {row.map((cell, j) => (
              <td
                key={j}
                style={{
                  padding: '8px 12px 8px 0',
                  color: 'var(--text-secondary)',
                  verticalAlign: 'top',
                }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border-hairline)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px',
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  );
}

export function About() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '200px 1fr',
        gap: 32,
        maxWidth: 1100,
        margin: '0 auto',
        padding: '32px 24px',
      }}
    >
      {/* Sidebar nav */}
      <nav style={{ position: 'sticky', top: 24, alignSelf: 'start' }}>
        <Label>On this page</Label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                textDecoration: 'none',
                padding: '4px 0',
                lineHeight: 1.4,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
            >
              {s.title}
            </a>
          ))}
        </div>
      </nav>

      {/* Main content */}
      <main style={{ minWidth: 0 }}>
        <h1
          style={{
            fontSize: 18,
            fontWeight: 500,
            color: 'var(--text-primary)',
            marginBottom: 6,
          }}
        >
          Metric reference
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 32, lineHeight: 1.6 }}>
          Definitions, computation rules, and assumptions for every number shown in this dashboard.
          Source of truth: <code style={{ fontSize: 12 }}>src/lib/vpCompute.ts</code> and{' '}
          <code style={{ fontSize: 12 }}>src/views/WeeklyScorecard.tsx</code>.
        </p>

        {/* ── Core metrics ─────────────────────────────────────────────── */}
        <Card>
          <SectionHead id="core">Core metrics</SectionHead>
          <DefRow term="Booked">
            Revenue from deals in stage "7. Win". Paced monthly across the engagement's{' '}
            <code style={{ fontSize: 12 }}>start_date</code> and{' '}
            <code style={{ fontSize: 12 }}>duration_months</code>, then summed into the fiscal
            quarter. Deduplicated by <code style={{ fontSize: 12 }}>dealKey</code> so a single deal
            appearing across multiple sellers is not double-counted within one seller's view.
          </DefRow>
          <DefRow term="Committed">
            Face-value revenue from deals in stages 5 (Commercial proposal) and 6 (Contracting),
            paced to the quarter using the same start_date + duration_months method as booked. No
            probability discount is applied — these are treated as near-certain.
            <br />
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              Does not apply the $100K floor — uses actual deal_size only.
            </span>
          </DefRow>
          <DefRow term="Forecast">
            Booked + Committed for the selected quarter scope. Used as the primary headline number
            in both the Pipeline health KPI strip and the Deal movement pipeline health
            card.
          </DefRow>
          <DefRow term="Forecast gap">
            Forecast − Target. Positive = above target; negative = gap remaining.
          </DefRow>
          <DefRow term="Weighted pipeline (EV)">
            Empirical expected value summed across all open active-stage deals (stages 1–6) for the
            selected quarter. See the "Empirical EV" section below for the full formula.
          </DefRow>
          <DefRow term="Pipeline coverage">
            Weighted pipeline ÷ target for the quarter scope. Coverage ≥ 1× means the EV-weighted
            pipeline equals or exceeds target — not a guarantee of hitting target, as EV discounts
            are applied.
          </DefRow>
          <DefRow term="Target">
            Quarterly revenue target per seller, set manually in the shared dashboard state
            (Admin tab → Targets). Stored as seller||quarter key pairs. Lookup is
            case-insensitive on the seller name and normalized quarter label (e.g. "Q1'27").
          </DefRow>
          <DefRow
            term="Won (FY)"
            note="Shown in the Deal movement funnel section"
          >
            Count and total deal_size of all won deals whose start_date falls within the current
            fiscal year (April 1 of the prior calendar year through March 31). Compared to the
            prior snapshot to show a delta.
          </DefRow>
        </Card>

        {/* ── Quarter pacing ───────────────────────────────────────────── */}
        <Card>
          <SectionHead id="pacing">Quarter pacing</SectionHead>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
            A deal's total contract value (TCV) is spread evenly month-by-month starting from{' '}
            <code style={{ fontSize: 12 }}>start_date</code> over{' '}
            <code style={{ fontSize: 12 }}>duration_months</code> months. Each month contributes{' '}
            <code style={{ fontSize: 12 }}>TCV / duration_months</code>. A month is attributed to a
            quarter by converting its date to a fiscal quarter label. The paced amount for any given
            quarter is the sum of all monthly slices that fall in that quarter.
          </p>
          <DefRow term="Fiscal year">
            April 1 – March 31. FY'27 = Apr 2026 – Mar 2027. Quarter labels are Q1'27 (Apr–Jun),
            Q2'27 (Jul–Sep), Q3'27 (Oct–Dec), Q4'27 (Jan–Mar). Quarter index is derived from the
            fiscal month offset (month − April, wrapping at 12).
          </DefRow>
          <DefRow term="duration_months fallback">
            If duration_months is missing, zero, or non-numeric, it is treated as 1 (single-month
            engagement). This avoids division-by-zero and prevents deals from being silently
            excluded.
          </DefRow>
          <DefRow term="start_date fallback">
            If start_date is missing or unparseable, the deal contributes $0 to all quarterly
            pacing. It still appears in stage counts and EV calculations (which use intro_date, not
            start_date).
          </DefRow>
          <DefRow term="Deduplication (dealKey)">
            Deals are deduplicated within each seller view using the key:{' '}
            <code style={{ fontSize: 12 }}>deal||intro_date</code> (both lowercased, trimmed). This
            prevents the same deal record appearing twice if the Monday.com board has duplicate rows.
          </DefRow>
        </Card>

        {/* ── Empirical EV ─────────────────────────────────────────────── */}
        <Card>
          <SectionHead id="ev">Empirical EV (weighted pipeline)</SectionHead>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
            EV = stage_probability × deal_size × time_weight
          </p>

          <div style={{ marginBottom: 20 }}>
            <Label>Stage probabilities</Label>
            <p
              style={{
                fontSize: 12,
                color: 'var(--text-tertiary)',
                marginBottom: 8,
                marginTop: 4,
              }}
            >
              Empirically derived from MathCo historical win rates. Not adjustable from the UI.
              Source of truth: <code>EMPIRICAL_STAGE</code> in{' '}
              <code>src/lib/vpCompute.ts</code>.
            </p>
            <Table
              headers={['Stage', 'Name', 'Win probability']}
              rows={[
                ['1', 'Intro', '8%'],
                ['2', 'Qualification', '10%'],
                ['3', 'Capability', '19%'],
                ['4', 'Problem scoping', '29%'],
                ['5', 'Commercial proposal', '44%'],
                ['6', 'Contracting', '90%'],
              ]}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <Label>$100K deal size floor (stages 1–4)</Label>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              For deals in stages 1–4, the EV calculation uses max($100K, deal_size). This prevents
              early-stage deals with no size entered from contributing $0 to EV, since the actual
              contract value is unknown at that stage. Stages 5–6 use the actual deal_size with no
              floor.
            </p>
            <p
              style={{
                fontSize: 12,
                color: 'var(--text-tertiary)',
                marginTop: 4,
              }}
            >
              The "top-of-funnel quality" flag in the pipeline health card shows what fraction of
              total EV comes from floored (stage 1–4) deals. A high floored share means EV is
              driven by assumptions, not confirmed deal sizes.
            </p>
          </div>

          <div>
            <Label>Time weight (quarterly EV view only)</Label>
            <p
              style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                lineHeight: 1.55,
                marginBottom: 8,
              }}
            >
              When EV is attributed to a specific quarter, a time weight is applied based on how
              many quarters away the target quarter is from the deal's intro_date quarter:
            </p>
            <Table
              headers={['Offset (target Q − intro Q)', 'Weight', 'Interpretation']}
              rows={[
                ['0 quarters', '21%', 'Introduced in the same quarter as target — unlikely to close'],
                ['1 quarter', '53%', 'One quarter of runway — peak close probability'],
                ['2+ quarters', '26%', 'More than one quarter away — longer tail'],
              ]}
            />
            <p
              style={{
                fontSize: 12,
                color: 'var(--text-tertiary)',
                marginTop: 8,
              }}
            >
              The closure outlook EV in the Deal movement deal list does not apply this time
              weight — it uses raw stage_probability × deal_size, since it is not attributed to a
              specific quarter.
            </p>
          </div>
        </Card>

        {/* ── Risk signals ─────────────────────────────────────────────── */}
        <Card>
          <SectionHead id="risk">Risk signals</SectionHead>

          <div style={{ marginBottom: 20 }}>
            <Label>Deal staleness</Label>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: 12 }}>
              Days since a deal last changed stage, computed from the snapshot history in{' '}
              <code style={{ fontSize: 12 }}>dashboard_versions</code>. One snapshot per day (the
              latest intraday snapshot is used). The RPC{' '}
              <code style={{ fontSize: 12 }}>get_deal_staleness()</code> scans all snapshots since
              April 1, 2026 and computes, for each deal: the most recent date its stage_num differed
              from its current stage_num. If no prior stage is found, the deal's first-seen date in
              the snapshot history is used as the reference point.
            </p>
            <p
              style={{
                fontSize: 12,
                color: 'var(--text-tertiary)',
                marginBottom: 12,
              }}
            >
              This is a proxy for deal movement — the only reliable signal available, since
              last_connect_date is not populated in Monday.com and stage_entry_date does not exist
              in the data model.
            </p>

            <Label>Staleness thresholds by stage</Label>
            <Table
              headers={['Stage', 'Name', 'Stale after', 'Red (critical) after']}
              rows={[
                ['1', 'Intro', '45 days', '67 days (1.5×)'],
                ['2', 'Qualification', '30 days', '45 days'],
                ['3', 'Capability', '21 days', '31 days'],
                ['4', 'Problem scoping', '21 days', '31 days'],
                ['5', 'Commercial proposal', '14 days', '21 days'],
                ['6', 'Contracting', '14 days', '21 days'],
              ]}
            />
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>
              The "red" threshold is 1.5× the stale threshold. Below the stale threshold the deal
              shows no badge. Between stale and red: amber "Stale Xd". Above red: red "Stale Xd".
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <Label>No next steps</Label>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              A deal has "no next steps" if its{' '}
              <code style={{ fontSize: 12 }}>next_meeting_date</code> is missing or is in the past
              (before today at midnight). This is independent of staleness — a deal can be moving
              stages but have no future meeting scheduled.
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <Label>Risk groups (mutually exclusive filters)</Label>
            <Table
              headers={['Group', 'Condition', 'Color']}
              rows={[
                ['Critical', 'Stale AND no next steps — highest urgency', 'Red'],
                ['Stale only', 'Stale in stage, but has a future next_meeting_date', 'Amber'],
                ['No next steps only', 'Has no future meeting, but not yet stale by threshold', 'Amber'],
                ['On track', 'Neither stale nor missing next steps', 'Green'],
              ]}
            />
          </div>

          <DefRow term="Seller coaching text (VP)">
            Each seller row in Pipeline health shows a coaching sub-line if the seller has ≥1
            stale deal or ≥1 deal with no next steps. Format: "X stale in stage · Y no next steps".
            Counts are computed from the current open deal set filtered to the active quarter scope.
          </DefRow>
          <DefRow term="Pipeline health card (WS)">
            Shows total stale count and no-next-steps count across all open active-stage deals
            visible in the current seller + quarter filter. "Stale in stage" = deals at or past
            their stage-specific threshold. "No next steps" = deals missing a future
            next_meeting_date.
          </DefRow>
        </Card>

        {/* ── Data source and refresh ──────────────────────────────────── */}
        <Card>
          <SectionHead id="data">Data source and refresh</SectionHead>
          <DefRow term="Data source">
            Monday.com board (sales pipeline). Synced via the{' '}
            <code style={{ fontSize: 12 }}>sync-monday-board</code> Supabase Edge Function, which
            fetches all board items and writes a versioned JSONB snapshot to{' '}
            <code style={{ fontSize: 12 }}>dashboard_versions</code>.
          </DefRow>
          <DefRow term="Snapshot model">
            Each sync creates one row in <code style={{ fontSize: 12 }}>dashboard_versions</code>{' '}
            containing the full board state as a JSONB blob. Versions are immutable — the dashboard
            reads a specific version's <code style={{ fontSize: 12 }}>dataset.all_deals_rows</code>{' '}
            array. The "latest" version is selected by default on load.
          </DefRow>
          <DefRow term="Staleness data refresh">
            Deal staleness is loaded via the{' '}
            <code style={{ fontSize: 12 }}>get_deal_staleness()</code> RPC. It is cached for 1 hour
            client-side (TanStack Query staleTime). It scans all snapshots from April 1, 2026 to
            present — a relatively expensive query, hence the aggressive cache TTL.
          </DefRow>
          <DefRow term="Seller matching">
            A deal is attributed to a seller if: (1) the seller's canonical name or any alias
            appears in <code style={{ fontSize: 12 }}>matched_sellers</code> (an array field set by
            the sync function), or (2) the seller alias appears in the{' '}
            <code style={{ fontSize: 12 }}>owner</code> / <code style={{ fontSize: 12 }}>seller</code>{' '}
            / <code style={{ fontSize: 12 }}>deal_owner</code> field (substring match). The
            matched_sellers check takes priority.
          </DefRow>
          <DefRow term="Active sellers">
            Akshay Iyer, Somya, Maruti Peri, Andy Shankar, Sahana, Suvom Mitro. Defined in{' '}
            <code style={{ fontSize: 12 }}>ACTIVE_SELLERS</code> in{' '}
            <code style={{ fontSize: 12 }}>src/lib/vpCompute.ts</code>. The "Overall" selector
            aggregates across all six sellers.
          </DefRow>
          <DefRow term="Active stages">
            Stages 1–6 (Intro through Contracting) are "active" pipeline. Won (7), Lost (8),
            Disqualified (9), No Show/Reschedule (10), Latent Pool variants (11–12) are excluded
            from open pipeline counts and EV. Won deals are included in booked revenue.
          </DefRow>
        </Card>

        {/* ── Known limitations ────────────────────────────────────────── */}
        <Card>
          <SectionHead id="limits">Known limitations</SectionHead>
          <DefRow
            term="last_connect_date"
            note="Data quality issue — do not use for activity-based risk"
            warn
          >
            The last_connect_date field (and all aliases: last_meeting_date, last_call_date,
            last_activity_date, last_touch_date, last_connected_date) is 0% populated in the current
            Monday.com data export. Risk metrics therefore rely entirely on snapshot-derived
            staleness rather than last-activity timestamps.
          </DefRow>
          <DefRow
            term="age_days (Stage 1)"
            note="Negative values observed — unreliable"
            warn
          >
            Average age_days for Stage 1 deals is approximately −24 days, indicating a data quality
            bug in the sync (likely computing age from a future reference date). age_days is not
            used in any metric; staleness from snapshot history is used instead.
          </DefRow>
          <DefRow
            term="next_meeting_date coverage"
            note="~44.7% populated as of last analysis"
            warn
          >
            Only around 45% of active deals have a populated next_meeting_date. The "no next steps"
            signal is meaningful but will flag ~55% of deals by default simply due to missing data.
            Sellers should keep this field updated in Monday.com for the signal to be useful.
          </DefRow>
          <DefRow term="Snapshot history depth">
            Staleness computation uses snapshots from April 1, 2026 onward. Deals introduced before
            that date have a staleness floor at April 1 — they cannot show stage changes earlier
            than the first captured snapshot.
          </DefRow>
          <DefRow term="Snapshot frequency">
            Snapshots are written on each manual sync trigger, not on a fixed schedule. Staleness
            days are computed from calendar dates, not sync counts — but the snapshot coverage may
            have gaps on days when no sync was triggered.
          </DefRow>
          <DefRow term="$100K floor accuracy">
            Stage 1–4 deals without a deal_size entered show EV based on the $100K floor assumption.
            This can overstate or understate pipeline if the actual deal size is very different from
            $100K. Sellers should enter a deal_size estimate as early as qualification.
          </DefRow>
        </Card>
      </main>
    </div>
  );
}
