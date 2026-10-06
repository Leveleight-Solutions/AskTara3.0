import {
  BedDouble,
  CalendarDays,
  Check,
  MapPin,
  Plane,
  Ship,
  Sparkles,
  Utensils,
  Wallet,
  ChevronRight,
} from 'lucide-react';
import type { StudioAssistantAction } from '../../shared/studio-assistant';
import { buildStudioAssistantActions } from '../../shared/studio-assistant';
import type { StudioWorkspace } from '../../shared/studio';

export function StudioChatActions({
  workspace,
  busy,
  onAction,
  notice,
  onChoice,
}: {
  workspace: StudioWorkspace;
  busy: boolean;
  onAction: (action: StudioAssistantAction) => void;
  notice?: string;
  onChoice?: (message: string) => void;
}) {
  const actions = buildStudioAssistantActions(workspace);
  const main = actions[0];
  return (
    <section className="studio-chat-actions" aria-label="Tara planning actions">
      {notice && (
        <p className="studio-action-notice" role="status">
          <Check size={13} /> {notice}
        </p>
      )}
      {main && (
        <div className="studio-next-action">
          <span>
            <Sparkles size={14} /> YOUR NEXT STEP
          </span>
          <strong>{main.label}</strong>
          <p>{main.detail}</p>
          <button disabled={busy || Boolean(main.disabledReason)} onClick={() => onAction(main)}>
            {main.kind === 'approve_route'
              ? 'Confirm'
              : main.kind === 'answer'
                ? 'Choose an answer'
                : main.label}
            <ChevronRight size={14} />
          </button>
        </div>
      )}
      <div className="studio-chat-action-chips">
        {actions.slice(1).map((action) => {
          const Icon =
            action.kind === 'hotels'
              ? BedDouble
              : action.kind === 'flights' || (action.kind === 'journey' && action.mode !== 'cruise')
                ? Plane
                : action.kind === 'cruises' ||
                    (action.kind === 'journey' && action.mode === 'cruise')
                  ? Ship
                  : action.kind === 'food'
                    ? Utensils
                    : action.kind === 'generate_itinerary' || action.kind === 'activities'
                      ? CalendarDays
                      : action.kind === 'destinations'
                        ? MapPin
                        : action.kind === 'answer' && action.questionId === 'budget'
                          ? Wallet
                          : Sparkles;
          return (
            <button
              key={action.id}
              disabled={busy || Boolean(action.disabledReason)}
              title={action.disabledReason || action.detail}
              onClick={() => onAction(action)}
            >
              <Icon size={13} />
              {action.label}
            </button>
          );
        })}
      </div>
      {onChoice &&
        actions
          .filter((action) => action.questionId !== 'clarification' && action.choices?.length)
          .map((action) => (
            <div
              className="studio-chat-action-chips"
              key={`${action.id}-choices`}
              aria-label="Choose the destination stay length"
            >
              {action.choices?.map((choice) => (
                <button
                  key={choice.message}
                  type="button"
                  disabled={busy}
                  onClick={() => onChoice(choice.message)}
                >
                  <Check size={13} /> {choice.label}
                </button>
              ))}
              <button type="button" disabled={busy} onClick={() => onAction(action)}>
                Edit stay length
              </button>
            </div>
          ))}
    </section>
  );
}
