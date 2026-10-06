import { useEffect, useState } from 'react';
import {
  CalendarDays,
  ChevronRight,
  Edit3,
  MapPin,
  Plane,
  Plus,
  Ship,
  Sparkles,
  Utensils,
  BedDouble,
  Wallet,
  Check,
  ShieldCheck,
  CloudSun,
} from 'lucide-react';
import { Badge, Button, Flex, Text } from '@radix-ui/themes';
import type { StudioWorkspace } from '../../shared/studio';
import { money, readableDate } from '../api';
import { studioCanvasBudget } from './studioCanvasBudget';
import { STUDIO_TRIP_BRIEFING_FRESH_MS } from '../../shared/studio-trip-briefing';
import { studioCanvasTravelStatus } from './studioCanvasTravelStatus';
import './StudioTripCanvas.css';

export type StudioCanvasTool =
  'client' | 'structure' | 'services' | 'itinerary' | 'recommendations' | 'proposal';
export function StudioTripCanvas({
  workspace,
  busy,
  onEdit,
  onEditDay,
  onSuggest,
  onApprove,
  onAddService,
}: {
  workspace: StudioWorkspace;
  busy: boolean;
  onEdit: (tool: StudioCanvasTool) => void;
  onEditDay: (index: number) => void;
  onSuggest: (message: string) => void;
  onApprove: () => void;
  onAddService: (kind: 'hotels' | 'flights' | 'cruises') => void;
}) {
  const [dayIndex, setDayIndex] = useState(0);
  useEffect(() => setDayIndex(0), [workspace.id]);
  const days = workspace.itinerary?.days || [];
  const day = days[Math.min(dayIndex, Math.max(0, days.length - 1))];
  const selected = workspace.items.filter((item) => item.included);
  const budget = studioCanvasBudget(workspace);
  const [clock, setClock] = useState(Date.now);
  const travelStatus = studioCanvasTravelStatus(workspace, Math.max(clock, Date.now()));
  useEffect(() => {
    const now = Date.now();
    const times = [
      workspace.tripBriefing?.checkedAt,
      ...(workspace.entryRequirements?.map((entry) => entry.checkedAt) || []),
      ...(workspace.tripBriefing?.stops.map((stop) => stop.weather.checkedAt) || []),
    ]
      .filter(Boolean)
      .map((time) => Date.parse(time!))
      .filter(Number.isFinite);
    const transitions = [
      ...times.filter((time) => time > now && time - now <= 5000),
      ...times.map((time) => time + STUDIO_TRIP_BRIEFING_FRESH_MS),
    ].filter((time) => time > now);
    if (!transitions.length) return;
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      Math.min(...transitions) - now + 20,
    );
    return () => window.clearTimeout(timer);
  }, [workspace.tripBriefing, workspace.entryRequirements, clock]);
  const hasRoute = workspace.stops.length > 0;
  const nightsKnown = hasRoute && workspace.stops.every((stop) => stop.nights !== null);
  return (
    <section
      className="studio-trip-board"
      aria-label="Interactive itinerary"
      data-testid="studio-trip-board"
    >
      <div className="studio-board-heading">
        <div>
          <span className="studio-eyebrow">YOUR TRIP, TAKING SHAPE</span>
          <h2>Itinerary</h2>
        </div>
        <Button variant="ghost" size="1" disabled={busy} onClick={() => onEdit('structure')}>
          <Edit3 size={14} /> Edit route
        </Button>
      </div>
      <div className="studio-board-route">
        {hasRoute ? (
          workspace.stops.map((stop, index) => (
            <button
              key={stop.id}
              disabled={busy}
              onClick={() => onEdit('structure')}
              aria-label={`Edit ${stop.name} route stop`}
            >
              <span className="studio-route-dot">{index + 1}</span>
              <span>
                <strong>{stop.name}</strong>
                <small>
                  {stop.nights === null ? 'Stay length to choose' : `${stop.nights} nights`}
                  {stop.arrivalDate ? ` · ${readableDate(stop.arrivalDate)}` : ''}
                </small>
              </span>
              <ChevronRight size={14} />
            </button>
          ))
        ) : (
          <div className="studio-board-empty">
            <MapPin size={25} />
            <h3>Where will the story begin?</h3>
            <p>
              Tell Tara where your client wants to go, or choose a personalised suggestion in the
              conversation.
            </p>
            <Button
              size="2"
              variant="soft"
              onClick={() => onSuggest('Help me choose a destination for this client.')}
              disabled={busy}
            >
              Explore destinations <Sparkles size={14} />
            </Button>
          </div>
        )}
        {hasRoute && !workspace.structureAccepted && (
          <div className="studio-route-approval">
            <Text size="1" color="gray">
              Review the route before adding travel options.
            </Text>
            <Button size="2" disabled={busy || !nightsKnown} onClick={onApprove}>
              <Check size={14} /> Use this route
            </Button>
          </div>
        )}
      </div>
      {hasRoute && (
        <div className="studio-travel-status" aria-label="Travel checks overview">
          <span>
            <ShieldCheck size={13} />
            {travelStatus.entryLabel}
          </span>
          <span>
            <CloudSun size={13} />
            {travelStatus.weatherLabel}
          </span>
          <button disabled={busy} onClick={() => onEdit('structure')}>
            Details
          </button>
        </div>
      )}
      <div className="studio-board-section-heading">
        <h3>
          <CalendarDays size={15} /> Day by day
        </h3>
        <Button size="1" variant="ghost" onClick={() => onEdit('itinerary')} disabled={busy}>
          Manage days
        </Button>
      </div>
      {days.length ? (
        <>
          <div className="studio-day-switcher" role="tablist" aria-label="Itinerary days">
            {days.map((item, index) => (
              <button
                key={`${item.day}:${item.cruiseDayId || item.date}`}
                role="tab"
                id={`studio-canvas-day-${workspace.id}-${item.day}`}
                aria-controls={`studio-canvas-day-panel-${workspace.id}`}
                tabIndex={index === Math.min(dayIndex, days.length - 1) ? 0 : -1}
                onKeyDown={(event) => {
                  const next =
                    event.key === 'ArrowRight'
                      ? (index + 1) % days.length
                      : event.key === 'ArrowLeft'
                        ? (index - 1 + days.length) % days.length
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? days.length - 1
                            : null;
                  if (next === null) return;
                  event.preventDefault();
                  setDayIndex(next);
                  (
                    event.currentTarget.parentElement?.children[next] as HTMLElement | undefined
                  )?.focus();
                }}
                aria-selected={index === Math.min(dayIndex, days.length - 1)}
                onClick={() => setDayIndex(index)}
                className={index === Math.min(dayIndex, days.length - 1) ? 'is-selected' : ''}
              >
                Day {item.day}
              </button>
            ))}
          </div>
          {day && (
            <article
              className="studio-day-card"
              role="tabpanel"
              id={`studio-canvas-day-panel-${workspace.id}`}
              aria-labelledby={`studio-canvas-day-${workspace.id}-${day.day}`}
              aria-label={`Day ${day.day} itinerary`}
            >
              <div className="studio-day-card-heading">
                <div>
                  <small>
                    {day.date ? readableDate(day.date) : 'Flexible date'}
                    {day.cruiseId ? ' · Cruise day' : ''}
                  </small>
                  <h3>{day.title}</h3>
                </div>
                <button
                  aria-label={`Edit day ${day.day}`}
                  disabled={busy}
                  onClick={() => onEditDay(days.indexOf(day))}
                >
                  <Edit3 size={15} />
                </button>
              </div>
              {day.summary && <p className="studio-day-summary">{day.summary}</p>}
              <div className="studio-day-timeline">
                {day.activities.map((activity, index) => (
                  <div className="studio-timeline-entry" key={`${index}:${activity.title}`}>
                    <span className="studio-timeline-dot" />
                    <div>
                      <small>
                        {activity.period === 'flexible' ? 'At your own pace' : activity.period}
                      </small>
                      <strong>{activity.title}</strong>
                      <p>{activity.description}</p>
                      {activity.sources.length > 0 && (
                        <details>
                          <summary>Sources</summary>
                          {activity.sources.map((source) => (
                            <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                              {source.label}
                            </a>
                          ))}
                        </details>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {!day.activities.length && (
                <p className="studio-day-summary">
                  Add your own stops or ask Tara for ideas for this day.
                </p>
              )}
              <div className="studio-day-actions">
                <Button
                  variant="soft"
                  size="1"
                  disabled={busy}
                  onClick={() =>
                    onSuggest(
                      `Suggest activities and places to eat for day ${day.day}: ${day.title}${day.date ? ` on ${day.date}` : ''}. Keep the other days unchanged.`,
                    )
                  }
                >
                  <Sparkles size={13} /> Ask for ideas
                </Button>
                <Button
                  variant="ghost"
                  size="1"
                  disabled={busy}
                  onClick={() => onEditDay(days.indexOf(day))}
                >
                  <Plus size={13} /> Add a stop
                </Button>
              </div>
            </article>
          )}
        </>
      ) : (
        <div className="studio-board-empty studio-board-empty--small">
          <CalendarDays size={23} />
          <h3>A little structure, endless possibilities.</h3>
          <p>
            Your arrival, outings, meals and cruise days will appear here as you plan with Tara.
          </p>
          <Button
            size="2"
            variant="soft"
            disabled={busy || !nightsKnown}
            onClick={() =>
              onSuggest(
                'Build the complete day-by-day itinerary for the agreed route and client preferences.',
              )
            }
          >
            <Sparkles size={14} /> Build my days
          </Button>
        </div>
      )}
      <div className="studio-board-section-heading">
        <h3>
          <BedDouble size={15} /> Travel & stays
        </h3>
        <Button
          size="1"
          variant="ghost"
          disabled={busy || !workspace.structureAccepted}
          onClick={() => onEdit('services')}
        >
          Edit
        </Button>
      </div>
      <div className="studio-selected-services">
        {selected.map((item) => {
          const Icon =
            item.kind === 'flight'
              ? Plane
              : item.kind === 'cruise'
                ? Ship
                : item.kind === 'hotel'
                  ? BedDouble
                  : MapPin;
          const image =
            'imageUrl' in item &&
            typeof item.imageUrl === 'string' &&
            /^https:\/\//.test(item.imageUrl)
              ? item.imageUrl
              : '';
          return (
            <button
              key={item.id}
              onClick={() => onEdit('services')}
              disabled={busy}
              className="studio-selected-service"
            >
              {image ? (
                <img
                  src={image}
                  alt=""
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                <span>
                  <Icon size={18} />
                </span>
              )}
              <div>
                <strong>{item.title}</strong>
                <small>
                  {item.startDate ? readableDate(item.startDate) : 'Details to confirm'}
                  {item.price === null ? ' · Unpriced' : ` · ${money(item.price, item.currency)}`}
                </small>
                {item.needsReview && (
                  <Badge size="1" color="amber">
                    Review required
                  </Badge>
                )}
                {item.priceStatus === 'agent_estimate' && (
                  <Badge size="1" color="gray">
                    Estimate
                  </Badge>
                )}
                {item.priceStatus === 'sandbox' && (
                  <Badge size="1" color="amber">
                    Sandbox rate
                  </Badge>
                )}
              </div>
              <ChevronRight size={14} />
            </button>
          );
        })}
      </div>
      <div className="studio-add-service-row">
        <Button
          size="1"
          variant="soft"
          disabled={busy || !workspace.structureAccepted}
          onClick={() => onAddService('hotels')}
        >
          <BedDouble size={13} /> Hotels
        </Button>
        <Button
          size="1"
          variant="soft"
          disabled={busy || !workspace.structureAccepted}
          onClick={() => onAddService('flights')}
        >
          <Plane size={13} /> Flights
        </Button>
        <Button size="1" variant="soft" disabled={busy} onClick={() => onAddService('cruises')}>
          <Ship size={13} /> Cruises
        </Button>
      </div>
      <section className="studio-board-budget" aria-label="Trip budget">
        <div>
          <h3>
            <Wallet size={15} /> Budget
          </h3>
          <button disabled={busy} onClick={() => onEdit('client')}>
            Edit
          </button>
        </div>
        <strong>
          {money(budget.total, budget.currency)}
          <small>
            {budget.budget === null
              ? ' · budget to choose'
              : ` of ${money(budget.budget, budget.currency)}`}
          </small>
        </strong>
        {budget.budget !== null && (
          <div className="studio-budget-track">
            <span
              style={{ width: `${budget.percent}%` }}
              className={budget.remaining !== null && budget.remaining < 0 ? 'is-over' : ''}
            />
          </div>
        )}
        <p>
          Selected service amounts
          {budget.unpricedCount ? ` · ${budget.unpricedCount} unpriced` : ''}
          {budget.sandboxCount ? ` · ${budget.sandboxCount} sandbox options excluded` : ''}
        </p>
        {budget.otherCurrencies.map(([currency, total]) => (
          <p key={currency}>
            {money(total, currency)} quoted separately; currencies are not converted.
          </p>
        ))}
      </section>
      <Button
        variant="outline"
        disabled={busy || !workspace.structureAccepted}
        onClick={() => onEdit('proposal')}
      >
        Preview proposal <ChevronRight size={14} />
      </Button>
    </section>
  );
}
