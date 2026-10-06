import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, Sparkles } from 'lucide-react';
import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Progress,
  Text,
  TextField,
} from '@radix-ui/themes';
import type { StudioBrief, StudioQuestion, StudioStop, StudioWorkspace } from '../../shared/studio';
import { studioCountries } from '../../shared/studio-travel-research';

type Answer = { brief?: Partial<StudioBrief>; stops?: StudioStop[] };
const priority = [
  'route',
  'adults',
  'children',
  'childAges',
  'startDate',
  'nights',
  'passportNationality',
  'tripPurpose',
  'tripType',
  'outboundTransport',
  'returnTransport',
  'budget',
  'hotelStandard',
];

/** Direct answers save declared facts without asking the model to interpret a form. */
export function StudioGuidedBrief({
  workspace,
  disabled,
  onSave,
  onContinue,
  onAsk,
  questionId,
}: {
  workspace: StudioWorkspace;
  disabled: boolean;
  onSave: (answer: Answer) => Promise<void>;
  onContinue: () => void;
  onAsk: (text: string) => void;
  questionId?: string;
}) {
  const [skipped, setSkipped] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const questionHeading = useRef<HTMLHeadingElement | null>(null);
  const focusNext = useRef(false);
  const questions = [...workspace.qualification.questions];
  if (!workspace.brief.tripPurpose || workspace.brief.tripPurpose === 'undecided')
    questions.push({
      id: 'tripPurpose',
      label: 'What is this trip for?',
      reason: 'Entry requirements depend on the purpose of the visit.',
      required: false,
    });
  questions.sort((a, b) => {
    const order = (id: string) => (priority.includes(id) ? priority.indexOf(id) : priority.length);
    return order(a.id) - order(b.id);
  });
  const question =
    questions.find((q) => q.id === selected) || questions.find((q) => !skipped.includes(q.id));
  useEffect(() => {
    setSkipped([]);
    setSelected(questionId || '');
  }, [workspace.id, questionId]);
  useEffect(() => {
    const brief = workspace.brief;
    setValues({
      currency: brief.currency,
      date: brief.startDate,
      passport: brief.passportNationality || '',
      ...(question?.id === 'adults' && brief.adults !== null
        ? { number: String(brief.adults) }
        : question?.id === 'children' && brief.children !== null
          ? { number: String(brief.children) }
          : {}),
      ...Object.fromEntries(
        workspace.stops
          .filter((stop) => stop.nights !== null)
          .map((stop) => [stop.id, String(stop.nights)]),
      ),
      ...Object.fromEntries(brief.childAges.map((age, index) => [`age-${index}`, String(age)])),
    });
    setError('');
    if (focusNext.current) {
      questionHeading.current?.focus({ preventScroll: true });
      focusNext.current = false;
    }
  }, [question?.id, workspace.id]);
  const blocked = disabled || saving;
  const update = (key: string, value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }));
  async function save(answer: Answer) {
    setSaving(true);
    focusNext.current = true;
    setError('');
    try {
      await onSave(answer);
      setSelected('');
    } catch (cause) {
      focusNext.current = false;
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const chips = (choices: { label: string; answer: Answer }[]) => (
    <Flex gap="2" wrap="wrap" data-testid="studio-quick-answer">
      {choices.map(({ label, answer }) => (
        <Button
          key={label}
          type="button"
          size="3"
          variant="outline"
          disabled={blocked}
          onClick={() => void save(answer)}
        >
          {label}
        </Button>
      ))}
    </Flex>
  );
  const field = (
    key: string,
    label: string,
    type: 'text' | 'number' | 'date' = 'text',
    options: { min?: number; max?: number; step?: string; placeholder?: string } = {},
  ) => (
    <label>
      <Text as="div" size="2" weight="medium" mb="1">
        {label}
      </Text>
      <TextField.Root
        aria-label={label}
        type={type}
        value={values[key] || ''}
        onChange={(event) => update(key, event.target.value)}
        disabled={blocked}
        required
        {...options}
      />
    </label>
  );
  const country = (key: string, label: string) => (
    <label>
      <Text as="div" size="2" weight="medium" mb="1">
        {label}
      </Text>
      <select
        aria-label={label}
        value={values[key] || ''}
        onChange={(event) => update(key, event.target.value)}
        disabled={blocked}
        required
      >
        <option value="">Choose a country</option>
        {studioCountries.map((item) => (
          <option key={item.code} value={item.code}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!question || blocked) return;
    const id = question.id;
    const b = workspace.brief;
    if (id === 'route') {
      const stop: StudioStop = {
        id: crypto.randomUUID(),
        name: values.destination.trim(),
        country: values.country,
        nights: null,
        arrivalDate: b.startDate,
        departureDate: '',
        arrivalFixed: Boolean(b.startDate),
        onwardTransport: 'undecided',
        neighbourhood: '',
        notes: '',
      };
      await save({
        brief: { preferredDestination: stop.name, destinationCountry: stop.country },
        stops: [stop],
      });
    } else if (id === 'startDate') {
      const startDate = values.date;
      await save({
        brief: { startDate, datesFlexible: false },
        ...(workspace.stops.length
          ? {
              stops: workspace.stops.map((stop, index) =>
                index ? stop : { ...stop, arrivalDate: startDate, arrivalFixed: true },
              ),
            }
          : {}),
      });
    } else if (id === 'nights') {
      const stops = workspace.stops.map((stop) => ({ ...stop, nights: Number(values[stop.id]) }));
      if (!stops.length) {
        setError('Add a destination first.');
        return;
      }
      await save({ stops });
    } else if (id === 'childAges') {
      await save({
        brief: {
          childAges: Array.from({ length: b.children || 0 }, (_, index) =>
            Number(values[`age-${index}`]),
          ),
        },
      });
    } else if (id === 'budget') {
      await save({
        brief: {
          budget: Number(values.amount),
          currency: (values.currency || b.currency).toUpperCase(),
        },
      });
    } else if (id === 'passportNationality')
      await save({ brief: { passportNationality: values.passport } });
    else if (id === 'adults') await save({ brief: { adults: Number(values.number) } });
    else if (id === 'children') {
      const children = Number(values.number);
      await save({
        brief: { children, childAges: b.childAges.length === children ? b.childAges : [] },
      });
    } else if (id === 'hotelStandard')
      await save({ brief: { hotelStandard: values.answer.trim() } });
    else {
      // Agency questions retain their literal label and answer in private client context.
      await save({
        brief: {
          context: [b.context, `${question.label}: ${values.answer.trim()}`]
            .filter(Boolean)
            .join('\n'),
        },
      });
    }
  }
  function content(q: StudioQuestion) {
    const id = q.id;
    if (id === 'tripType')
      return chips([
        { label: 'Single destination', answer: { brief: { tripType: 'single' } } },
        { label: 'Multiple destinations', answer: { brief: { tripType: 'multiple' } } },
      ]);
    if (id === 'tripPurpose')
      return chips([
        { label: 'Holiday', answer: { brief: { tripPurpose: 'tourism' } } },
        { label: 'Business', answer: { brief: { tripPurpose: 'business' } } },
        { label: 'Study', answer: { brief: { tripPurpose: 'study' } } },
        { label: 'Other', answer: { brief: { tripPurpose: 'other' } } },
      ]);
    if (id === 'outboundTransport' || id === 'returnTransport')
      return chips([
        { label: 'Flight', answer: { brief: { [id]: 'flight' } } },
        { label: 'Cruise', answer: { brief: { [id]: 'cruise' } } },
      ]);
    return (
      <form aria-label="Answer brief question" onSubmit={(event) => void submit(event)}>
        <Flex direction="column" gap="3">
          {id === 'route' && (
            <Grid columns={{ initial: '1', sm: '2' }} gap="3">
              {field('destination', 'Destination', 'text', { placeholder: 'City or region' })}
              {country('country', 'Destination country')}
            </Grid>
          )}
          {id === 'passportNationality' && country('passport', 'Passport nationality')}
          {id === 'startDate' && (
            <>
              {field('date', 'Arrival date', 'date')}
              <Button
                type="button"
                variant="outline"
                disabled={blocked}
                onClick={() => void save({ brief: { datesFlexible: true, startDate: '' } })}
              >
                Flexible dates
              </Button>
            </>
          )}
          {id === 'nights' && (
            <Grid columns={{ initial: '1', sm: '2' }} gap="3">
              {workspace.stops.map((stop) => (
                <Box key={stop.id}>
                  {field(stop.id, `Nights in ${stop.name}`, 'number', { min: 0, max: 120 })}
                </Box>
              ))}
            </Grid>
          )}
          {id === 'adults' && (
            <>
              {chips(
                [1, 2, 4, 5].map((adults) => ({
                  label: `${adults} adult${adults === 1 ? '' : 's'}`,
                  answer: { brief: { adults } },
                })),
              )}
              {field('number', 'Adults travelling', 'number', { min: 1, max: 100 })}
            </>
          )}
          {id === 'children' && (
            <>
              {chips(
                [0, 1, 2].map((children) => ({
                  label: children
                    ? `${children} ${children === 1 ? 'child' : 'children'}`
                    : 'No children',
                  answer: {
                    brief: {
                      children,
                      childAges:
                        workspace.brief.childAges.length === children
                          ? workspace.brief.childAges
                          : [],
                    },
                  },
                })),
              )}
              {field('number', 'Children travelling', 'number', { min: 0, max: 30 })}
            </>
          )}
          {id === 'childAges' && (
            <Grid columns={{ initial: '1', sm: '2' }} gap="3">
              {Array.from({ length: workspace.brief.children || 0 }, (_, index) => (
                <Box key={index}>
                  {field(`age-${index}`, `Age of child ${index + 1}`, 'number', {
                    min: 0,
                    max: 17,
                  })}
                </Box>
              ))}
            </Grid>
          )}
          {id === 'budget' && (
            <Grid columns={{ initial: '1', sm: '2' }} gap="3">
              {field('amount', 'Total group budget', 'number', {
                min: 0,
                max: 10000000,
                step: 'any',
              })}
              <label>
                <Text as="div" size="2" weight="medium" mb="1">
                  Budget currency
                </Text>
                <select
                  aria-label="Budget currency"
                  value={values.currency || workspace.brief.currency}
                  onChange={(event) => update('currency', event.target.value)}
                  disabled={blocked}
                >
                  {[
                    ...new Set([
                      workspace.brief.currency,
                      'AUD',
                      'USD',
                      'EUR',
                      'GBP',
                      'NZD',
                      'CAD',
                      'NPR',
                      'INR',
                      'PKR',
                      'JPY',
                      'SGD',
                      'AED',
                    ]),
                  ].map((code) => (
                    <option key={code}>{code}</option>
                  ))}
                </select>
              </label>
            </Grid>
          )}
          {id === 'hotelStandard' && (
            <>
              {chips(
                ['3', '4', '5'].map((stars) => ({
                  label: `${stars} star`,
                  answer: { brief: { hotelStandard: `${stars}-star` } },
                })),
              )}
              {field('answer', 'Other accommodation preference')}
            </>
          )}
          {![
            'route',
            'passportNationality',
            'startDate',
            'nights',
            'adults',
            'children',
            'childAges',
            'budget',
            'hotelStandard',
          ].includes(id) && field('answer', 'Your answer')}
          <Button
            type="submit"
            disabled={blocked}
            loading={saving}
            style={{ alignSelf: 'flex-start' }}
          >
            Save answer <ArrowRight size={15} />
          </Button>
        </Flex>
      </form>
    );
  }
  return (
    <section
      className="studio-guided-brief"
      aria-label="Guided brief"
      data-testid="studio-next-question"
    >
      <Flex justify="between" align="center" gap="3" mb="3">
        <Text size="1" weight="medium" color="gray">
          A FEW DETAILS, ONE AT A TIME
        </Text>
        <Badge variant="soft" color="gray">
          {workspace.qualification.score}% ready
        </Badge>
      </Flex>
      <Progress
        size="1"
        value={workspace.qualification.score}
        aria-label="Brief completeness"
        mb="4"
      />
      {question ? (
        <>
          <Heading as="h2" size="5" mb="2" ref={questionHeading} tabIndex={-1}>
            {question.label}
          </Heading>
          <Text as="p" size="2" color="gray" mb="4">
            {question.reason}
          </Text>
          {content(question)}
          <Flex mt="3" gap="3" wrap="wrap">
            <Button
              type="button"
              variant="ghost"
              color="gray"
              disabled={blocked}
              onClick={() => {
                focusNext.current = true;
                setSkipped((previous) => [...previous, question.id]);
                setSelected('');
              }}
            >
              Skip for now
            </Button>
            <Button
              type="button"
              variant="ghost"
              color="gray"
              disabled={blocked}
              onClick={() => onAsk(`Help me answer: ${question.label}`)}
            >
              <Sparkles size={14} /> Ask Tara
            </Button>
          </Flex>
        </>
      ) : (
        <Flex direction="column" align="start" gap="3">
          <Check size={22} />
          <Heading as="h2" size="5" ref={questionHeading} tabIndex={-1}>
            Ready to shape the journey
          </Heading>
          <Text size="2" color="gray">
            You can fill in the remaining details whenever you need them.
          </Text>
          <Button onClick={onContinue} disabled={blocked}>
            Review the route <ArrowRight size={15} />
          </Button>
        </Flex>
      )}
      {error && (
        <Text as="p" size="2" color="red" role="alert" mt="3">
          {error}
        </Text>
      )}
      {questions.length > 1 && (
        <details className="studio-details" style={{ marginTop: 18 }}>
          <summary>Choose another detail · {questions.length} still open</summary>
          <Flex gap="2" wrap="wrap" mt="3">
            {questions.map((q) => (
              <Button
                key={q.id}
                type="button"
                variant="soft"
                size="1"
                color="gray"
                disabled={blocked}
                onClick={() => {
                  focusNext.current = true;
                  setSelected(q.id);
                }}
              >
                {q.id === 'passportNationality'
                  ? 'Passport'
                  : q.id === 'tripType'
                    ? 'Trip type'
                    : q.id === 'startDate'
                      ? 'Dates'
                      : q.id === 'outboundTransport'
                        ? 'Outbound travel'
                        : q.id === 'returnTransport'
                          ? 'Return travel'
                          : q.id === 'hotelStandard'
                            ? 'Accommodation'
                            : q.id === 'tripPurpose'
                              ? 'Purpose'
                              : q.id === 'childAges'
                                ? 'Child ages'
                                : q.id.replace(/^./, (letter) => letter.toUpperCase())}
              </Button>
            ))}
          </Flex>
        </details>
      )}
    </section>
  );
}
