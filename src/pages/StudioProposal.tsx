import { useEffect, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Mail, Phone, Globe, Clock3, MapPin } from 'lucide-react';
import { api } from '../api';
import type { StudioClientProposal } from '../../shared/studio-proposals';
import { studioProposalIsStale, studioProposalMoney } from '../../shared/studio-proposals';
import './studio-proposal.css';

const dateLabel = (value: string) =>
  value
    ? new Date(`${value}T12:00:00Z`).toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'To be confirmed';

export function StudioProposalDocument({
  proposal,
  pdfUrl,
  preview = false,
}: {
  proposal: StudioClientProposal;
  pdfUrl?: string;
  preview?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const stale = studioProposalIsStale(proposal, now);
  return (
    <article
      className="client-proposal"
      style={{ '--proposal-accent': proposal.agency.accentColor } as CSSProperties}
    >
      {preview && (
        <div className="proposal-preview-banner">
          Private preview · Publish only when the client-facing details are ready.
        </div>
      )}
      <header className="proposal-brand">
        <div>
          {proposal.agency.logoDataUrl && <img src={proposal.agency.logoDataUrl} alt="" />}
          <strong>{proposal.agency.name}</strong>
        </div>
        {pdfUrl && (
          <a className="proposal-download" href={pdfUrl} download>
            <Download size={17} /> Download PDF
          </a>
        )}
      </header>
      <div className="proposal-hero">
        <p className="proposal-eyebrow">Your travel proposal</p>
        <h1>{proposal.title}</h1>
        {proposal.clientName && <p>Prepared for {proposal.clientName}</p>}
        <div className="proposal-trip-facts">
          <span>
            {dateLabel(proposal.trip.startDate)}
            {proposal.trip.endDate && ` – ${dateLabel(proposal.trip.endDate)}`}
          </span>
          {proposal.trip.adults !== null && <span>{proposal.trip.adults} adults</span>}
          {proposal.trip.children !== null && proposal.trip.children > 0 && (
            <span>{proposal.trip.children} children</span>
          )}
        </div>
      </div>
      <aside className={`proposal-validity ${stale ? 'stale' : ''}`} role="status">
        <Clock3 size={19} />
        <div>
          <strong>
            {stale ? 'Prices need reconfirmation' : 'A proposal for your consideration'}
          </strong>
          <p>
            {stale
              ? 'The price validity period has passed. You can still explore the proposal; your agent will refresh prices and availability before you proceed.'
              : `Prices require reconfirmation after ${new Date(proposal.validUntil).toLocaleString('en-AU')}, or sooner if availability changes.`}
          </p>
        </div>
      </aside>
      <section className="proposal-section">
        <h2>Your route</h2>
        <div className="proposal-route">
          {proposal.stops.map((stop, index) => (
            <div className="proposal-stop" key={stop.id}>
              <span className="proposal-stop-number">{index + 1}</span>
              <div>
                <h3>
                  {stop.name}
                  {stop.country && <span>, {stop.country}</span>}
                </h3>
                <p>
                  {stop.nights === null ? 'Nights to confirm' : `${stop.nights} nights`} ·{' '}
                  {dateLabel(stop.arrivalDate)}
                  {stop.departureDate && ` – ${dateLabel(stop.departureDate)}`}
                </p>
                {stop.neighbourhood && (
                  <p>
                    <MapPin size={13} /> {stop.neighbourhood}
                  </p>
                )}
                {index < proposal.stops.length - 1 && (
                  <small>
                    Onward travel:{' '}
                    {stop.onwardTransport === 'undecided'
                      ? 'to be confirmed'
                      : stop.onwardTransport}
                  </small>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      {proposal.items.length > 0 && (
        <section className="proposal-section">
          <h2>Included services</h2>
          <div className="proposal-service-grid">
            {proposal.items.map((item) => (
              <article key={item.id} className="proposal-service">
                <span className="proposal-eyebrow">{item.kind}</span>
                <h3>{item.title}</h3>
                {item.startDate && (
                  <p className="proposal-date">
                    {dateLabel(item.startDate)}
                    {item.endDate && ` – ${dateLabel(item.endDate)}`}
                  </p>
                )}
                <p className="proposal-description">{item.description}</p>
                <span className="proposal-status">
                  {item.status === 'externally_booked'
                    ? 'Externally booked · reported by your agent'
                    : item.status === 'placeholder'
                      ? 'Details to be confirmed'
                      : 'Proposed · not booked'}
                </span>
                <div className="proposal-item-price">
                  {item.price !== null && (
                    <strong>{studioProposalMoney(item.price, item.currency)}</strong>
                  )}
                  <small>
                    {item.priceStatus === 'sandbox'
                      ? 'Sandbox test rate · excluded from totals'
                      : item.priceStatus === 'agent_estimate'
                        ? 'Agent estimate · subject to confirmation'
                        : item.priceStatus === 'supplier_quote'
                          ? 'Supplier quote · subject to availability'
                          : 'Price to be confirmed'}
                  </small>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {proposal.recommendations.length > 0 && (
        <section className="proposal-section">
          <h2>Ideas to explore</h2>
          <p className="proposal-section-intro">A few suggestions to enjoy at your own pace.</p>
          <div className="proposal-service-grid">
            {proposal.recommendations.map((item) => (
              <article key={item.id} className="proposal-recommendation">
                <span className="proposal-eyebrow">
                  {proposal.stops.find((stop) => stop.id === item.stopId)?.name} · {item.category}
                </span>
                <h3>{item.name}</h3>
                <p className="proposal-description">{item.description}</p>
                {item.sources.length > 0 && (
                  <ul className="proposal-sources">
                    {item.sources.map((source, index) => (
                      <li key={`${source.url}-${index}`}>
                        <a href={source.url} target="_blank" rel="noopener noreferrer">
                          {source.label}
                        </a>
                        {source.checkedAt && (
                          <small> · Checked {dateLabel(source.checkedAt.slice(0, 10))}</small>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="proposal-section proposal-pricing">
        <h2>Proposal pricing</h2>
        {proposal.pricing.mode === 'package' ? (
          <>
            <p className="proposal-total">
              {proposal.pricing.packagePrice === null
                ? 'Package price to be confirmed'
                : studioProposalMoney(proposal.pricing.packagePrice, proposal.pricing.currency)}
            </p>
            <p>Package price set by your agent, subject to confirmation.</p>
          </>
        ) : (
          <>
            {proposal.pricing.totals.map((total) => (
              <div key={total.currency}>
                <p className="proposal-total">
                  {studioProposalMoney(total.amount, total.currency)}
                </p>
                <p>Priced items{total.containsEstimates ? ', including agent estimates' : ''}.</p>
              </div>
            ))}
            {!proposal.pricing.totals.length && <p>No confirmed priced items.</p>}
            {proposal.pricing.totals.length > 1 && (
              <p>Currencies are shown separately. No exchange rate has been applied.</p>
            )}
            {proposal.pricing.unpricedCount > 0 && (
              <p>
                {proposal.pricing.unpricedCount}{' '}
                {proposal.pricing.unpricedCount === 1
                  ? 'item still requires'
                  : 'items still require'}{' '}
                pricing. These figures are not a complete trip total.
              </p>
            )}
          </>
        )}
        {proposal.pricing.sandboxCount > 0 && (
          <p className="proposal-test-notice">
            {proposal.pricing.sandboxCount} services use sandbox test rates. These rates are
            illustrative and excluded from item totals.
          </p>
        )}
        {proposal.pricing.notes && <p className="proposal-description">{proposal.pricing.notes}</p>}
      </section>
      <footer className="proposal-footer">
        <p>{proposal.notice}</p>
        {proposal.agency.disclaimer && <p>{proposal.agency.disclaimer}</p>}
        <div className="proposal-contact">
          {proposal.agency.email && (
            <a href={`mailto:${proposal.agency.email}`}>
              <Mail size={15} />
              {proposal.agency.email}
            </a>
          )}
          {proposal.agency.phone && (
            <a href={`tel:${proposal.agency.phone}`}>
              <Phone size={15} />
              {proposal.agency.phone}
            </a>
          )}
          {proposal.agency.website && (
            <a href={proposal.agency.website} target="_blank" rel="noopener noreferrer">
              <Globe size={15} />
              Visit our website
            </a>
          )}
        </div>
        <small>Prepared {dateLabel(proposal.publishedAt.slice(0, 10))} · Read-only proposal</small>
      </footer>
    </article>
  );
}

export default function StudioProposal() {
  const { token = '' } = useParams();
  const [proposal, setProposal] = useState<StudioClientProposal | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setProposal(null);
    setError('');
    api<{ proposal: StudioClientProposal }>(`/studio/proposals/${encodeURIComponent(token)}`)
      .then((result) => {
        if (active) setProposal(result.proposal);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [token]);
  if (error)
    return (
      <main className="proposal-page proposal-empty">
        <h1>This proposal is unavailable</h1>
        <p>{error}</p>
        <p>Please contact your travel agent for the current link.</p>
      </main>
    );
  if (!proposal)
    return (
      <main className="proposal-page proposal-empty" role="status">
        Opening your travel proposal…
      </main>
    );
  return (
    <main className="proposal-page">
      <StudioProposalDocument
        proposal={proposal}
        pdfUrl={`/api/studio/proposals/${encodeURIComponent(token)}/pdf`}
      />
    </main>
  );
}
