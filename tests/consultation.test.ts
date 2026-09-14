import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTrip } from '../server/planner.ts';
import { defaultBrief } from '../server/agents/schedule.ts';
import {
  updateConsultation,
  getConsultationQuestions,
  hasUnsupportedParty,
  hasConfirmedAdultParty,
} from '../server/agents/consultation.ts';
import {
  defaultConsultation,
  type ConsultationState,
  type ConsultationUpdates,
} from '../shared/consultation.ts';
import { consultationSchema, travelBriefSchema } from '../server/validation.ts';
import type { Trip } from '../shared/types.ts';

const emptyUpdates = (): ConsultationUpdates => ({
  facts: [],
  services: [],
  currency: null,
  party: null,
});
function consult(message: string, trip: Trip = newTrip(), updates?: ConsultationUpdates) {
  const brief = trip.brief || defaultBrief();
  return updateConsultation({ trip, message, brief, updates });
}
function withState(state: ConsultationState): Trip {
  return { ...newTrip(), brief: { ...defaultBrief(), consultation: state } };
}
function withQuestion(question: string): Trip {
  const trip = newTrip();
  trip.messages.push({
    id: 'question',
    role: 'assistant',
    content: question,
    createdAt: new Date().toISOString(),
  });
  return trip;
}

test('trip placeholders and false service flags do not become confirmed customer facts', () => {
  const trip = newTrip();
  trip.brief = defaultBrief();
  const before = structuredClone(trip);
  const state = consult('Hello, can you help plan a holiday?', trip);
  assert.equal(state.currency, 'AUD');
  assert.deepEqual(state.facts, {});
  assert.deepEqual(state.services, defaultConsultation().services);
  assert.equal(state.party, undefined);
  assert.equal(state.flightJourney, undefined);
  assert.deepEqual(
    trip,
    before,
    'Consultation cannot mutate numeric placeholders or infer an airport/nationality',
  );
});

test('new model boolean guesses cannot seed legacy requested services', () => {
  const trip = newTrip();
  trip.brief = defaultBrief();
  const state = updateConsultation({
    trip,
    message: 'A quiet holiday',
    brief: { ...defaultBrief(), includeFlights: true, includeHotels: true },
  });
  assert.equal(state.services.flights.status, 'unknown');
  assert.equal(state.services.hotels.status, 'unknown');
});

test('literal trip facts retain evidence and explicit currency without changing the USD price ledger', () => {
  const trip = newTrip();
  const state = consult(
    'Plan 4 days in London starting November 18, 2026 for 2 adults, budget USD 2400. We prefer vegetarian food and quiet places.',
    trip,
  );
  for (const field of [
    'destination',
    'dates',
    'duration',
    'travelers',
    'budget',
    'interests',
  ] as const) {
    assert.equal(state.facts[field]?.source, 'message', field);
    assert.ok(state.facts[field]?.evidence, field);
  }
  assert.equal(state.currency, 'USD');
  assert.equal(state.facts.dates?.valueState, 'specified');
  assert.equal(state.services.flights.status, 'unknown');
  assert.equal(
    trip.budget,
    1500,
    'Extraction records provenance, not fabricated prices or conversions',
  );
});

test('flexible dates and budget are remembered without treating placeholders as specified', () => {
  const state = consult('My dates are flexible and I have no fixed budget.');
  assert.equal(state.facts.dates?.valueState, 'flexible');
  assert.equal(state.facts.budget?.valueState, 'flexible');
  assert.equal(consult('In November').facts.dates?.valueState, 'flexible');
  assert.equal(consult('November 18').facts.dates?.valueState, 'flexible');
  assert.equal(consult('Leaving in two weeks').facts.duration, undefined);
  assert.equal(consult('Can we find a $20 lunch?').facts.budget, undefined);
});

test('explicit requests, declines and already-booked services stay distinct across follow-ups', () => {
  let state = consult('Find flights for me. My hotels are already booked.');
  assert.equal(state.services.flights.status, 'requested');
  assert.equal(state.services.hotels.status, 'already_booked');
  state = consult('Add a quiet museum.', withState(state), {
    ...emptyUpdates(),
    services: [{ service: 'flights', status: 'unknown', evidence: 'Add a quiet museum.' }],
  });
  assert.equal(state.services.flights.status, 'requested');
  assert.equal(state.services.hotels.status, 'already_booked');
  state = consult('Actually, no flights needed.', withState(state));
  assert.equal(state.services.flights.status, 'not_needed');
  state = consult('I am not sure about flights now.', withState(state), {
    ...emptyUpdates(),
    services: [{ service: 'flights', status: 'unknown', evidence: 'not sure about flights' }],
  });
  assert.equal(state.services.flights.status, 'unknown');
});

test('ordinary Australian service wording retains explicit accommodation and flight scope', () => {
  const both = consult('Please find flights and accommodation');
  assert.equal(both.services.flights.status, 'requested');
  assert.equal(both.services.hotels.status, 'requested');
  const sorted = consult('My flights are sorted. No need for accommodation.');
  assert.equal(sorted.services.flights.status, 'already_booked');
  assert.equal(sorted.services.hotels.status, 'not_needed');
});

test('negative or hypothetical language is not service consent or a decline', () => {
  for (const message of [
    'No flights booked yet',
    'Flights are not booked',
    "We haven't booked flights",
    "Don't assume no flights",
    'Do we need flights?',
    'Maybe find flights',
  ]) {
    const state = consult(message, newTrip(), {
      ...emptyUpdates(),
      services: [{ service: 'flights', status: 'not_needed', evidence: message }],
    });
    assert.equal(state.services.flights.status, 'unknown', message);
  }
  const state = consult("We haven't booked flights", newTrip(), {
    ...emptyUpdates(),
    services: [{ service: 'flights', status: 'requested', evidence: "We haven't booked flights" }],
  });
  assert.equal(state.services.flights.status, 'unknown');
});

test('short replies resolve the service actually asked about without resolving a different service', () => {
  const trip = withQuestion('Would you like help finding flights?');
  for (const [message, expected] of [
    ['Yes please', 'requested'],
    ['No thanks', 'not_needed'],
    ["They're sorted", 'already_booked'],
  ] as const) {
    const state = consult(message, trip);
    assert.equal(state.services.flights.status, expected);
    assert.equal(state.services.hotels.status, 'unknown');
    assert.equal(state.services.flights.evidence, message);
  }
});

test('two-service questions require both or a named service, and itinerary-only is an explicit scope', () => {
  const trip = withQuestion('Would you like help with flights and accommodation?');
  assert.equal(consult('Yes please', trip).services.flights.status, 'unknown');
  for (const [message, expected] of [
    ['Yes, both please', 'requested'],
    ['Neither thanks', 'not_needed'],
    ['Both are sorted', 'already_booked'],
  ] as const) {
    const state = consult(message, trip);
    assert.equal(state.services.flights.status, expected);
    assert.equal(state.services.hotels.status, expected);
  }
  const state = consult('Just the itinerary, please', trip);
  assert.equal(state.services.flights.status, 'not_needed');
  assert.equal(state.services.hotels.status, 'not_needed');
});

test('unsupported extraction evidence is ignored and explicit user words override a contradictory decline', () => {
  const state = consult('Please find flights', newTrip(), {
    facts: [{ field: 'travelers', valueState: 'specified', evidence: '2 adults' }],
    services: [{ service: 'flights', status: 'not_needed', evidence: 'Please find flights' }],
    currency: { value: 'USD', evidence: 'Please find flights' },
    party: null,
  });
  assert.equal(state.facts.travelers, undefined);
  assert.equal(state.services.flights.status, 'requested');
  assert.equal(state.currency, 'AUD');
});

test('questions prioritise the interview and never exceed three or include a guessed nationality', () => {
  const trip = newTrip();
  const brief = { ...defaultBrief(), consultation: consult('Hello') };
  assert.deepEqual(
    getConsultationQuestions(trip, brief).map((q) => q.field),
    ['destination', 'dates'],
  );
  assert.equal(getConsultationQuestions(trip, brief, 100).length, 3);
  assert.equal(getConsultationQuestions(trip, brief, 0).length, 0);
  const state = consult('4 days in London, dates are flexible, for 2 adults.');
  assert.deepEqual(
    getConsultationQuestions(trip, { ...brief, consultation: state }).map((q) => q.field),
    ['flights', 'hotels'],
  );
});

test('legacy migration reads original user facts but never assistant-invented numbers', () => {
  const trip = newTrip();
  trip.brief = { ...defaultBrief(), originAirport: 'SYD', includeHotels: true };
  trip.messages.push(
    { id: 'user', role: 'user', content: 'London for 4 days', createdAt: new Date().toISOString() },
    {
      id: 'assistant',
      role: 'assistant',
      content: 'For 2 adults with a budget AUD 1500.',
      createdAt: new Date().toISOString(),
    },
  );
  const state = consult('Add museums.', trip);
  assert.equal(state.facts.duration?.source, 'message');
  assert.equal(state.facts.travelers, undefined);
  assert.equal(state.facts.budget, undefined);
  assert.equal(state.facts.origin?.source, 'profile');
  assert.equal(state.services.hotels.status, 'requested');
  assert.equal(state.services.flights.status, 'unknown');
});

test('an existing itinerary retains legacy USD currency while an untouched new draft starts in AUD', () => {
  const trip = newTrip();
  trip.itinerary = [{ day: 1, title: 'Saved day', items: [] }];
  assert.equal(consult('Keep the trip the same', trip).currency, 'USD');
  assert.equal(consult('Help plan a holiday', newTrip()).currency, 'AUD');
});

test('explicit form updates retain known facts, pending global route and service provenance', () => {
  const state = consult('Find flights for me.');
  state.route = [{ name: 'Cartagena, Colombia', days: 4 }];
  const form = defaultConsultation();
  form.facts.travelers = {
    source: 'form',
    evidence: 'Trip settings: 3 travellers',
    valueState: 'specified',
  };
  form.services.hotels = {
    status: 'not_needed',
    source: 'form',
    evidence: 'Hotel help: not needed',
  };
  const result = updateConsultation({
    trip: withState(state),
    brief: defaultBrief(),
    message: '',
    form,
  });
  assert.equal(result.facts.travelers?.source, 'form');
  assert.equal(result.services.flights.status, 'requested');
  assert.equal(result.services.hotels.status, 'not_needed');
  assert.deepEqual(result.route, state.route);
});

test('children and their actual ages remain separate from adult-only supplier compatibility', () => {
  let state = consult('We are 2 adults and 2 children aged 7 and 9.');
  assert.equal(state.party?.hasChildren, true);
  assert.deepEqual(state.party?.childAges, [7, 9]);
  assert.equal(hasUnsupportedParty({ ...defaultBrief(), consultation: state }), true);
  state = consult('Make it more relaxed.', withState(state));
  assert.deepEqual(state.party?.childAges, [7, 9]);
  state = consult('2 adults', withState(state));
  assert.equal(
    state.party?.hasChildren,
    true,
    'An adult count alone does not retract previously supplied children',
  );
  state = consult('Change to adults only, no children.', withState(state));
  assert.equal(hasUnsupportedParty({ ...defaultBrief(), consultation: state }), false);
  assert.deepEqual(state.party?.childAges, []);
});

test('a traveller count never confirms adult composition while an explicit adult count does', () => {
  for (const message of ['For 2 travelers', 'For two people', 'A group of 3']) {
    const state = consult(message);
    assert.equal(
      hasConfirmedAdultParty({ ...defaultBrief(), consultation: state }),
      false,
      message,
    );
  }
  for (const message of [
    'For 2 adults',
    'For two adults',
    'Just 1 adult',
    'Adults only',
    'Yes, all adults',
  ]) {
    const state = consult(message);
    assert.equal(state.party?.hasChildren, false, message);
    assert.equal(hasConfirmedAdultParty({ ...defaultBrief(), consultation: state }), true, message);
  }
  let state = consult('For 2 adults and 1 child aged 8');
  assert.equal(hasConfirmedAdultParty({ ...defaultBrief(), consultation: state }), false);
  state = consult('2 adults', withState(state));
  assert.equal(
    hasConfirmedAdultParty({ ...defaultBrief(), consultation: state }),
    false,
    'An adult count does not erase known children',
  );
  state = consult('Change to adults only.', withState(state));
  assert.equal(hasConfirmedAdultParty({ ...defaultBrief(), consultation: state }), true);
});

test('an explicit legacy adult count migrates while assistant-only adult assumptions do not', () => {
  const trip = newTrip();
  trip.messages.push({
    id: 'customer',
    role: 'user',
    content: 'For two adults',
    createdAt: new Date().toISOString(),
  });
  const state = consult('Make it quieter', trip);
  assert.equal(hasConfirmedAdultParty({ ...defaultBrief(), consultation: state }), true);
  const unconfirmed = withQuestion('I have assumed 2 adults. What do you prefer?');
  assert.equal(
    hasConfirmedAdultParty({
      ...defaultBrief(),
      consultation: consult('More museums', unconfirmed),
    }),
    false,
  );
});

test('a short yes confirms adults only when the preceding question clearly asks about composition', () => {
  const trip = withQuestion(
    'Are all travellers adults? If children are coming, please include their ages so they are not priced as adults.',
  );
  const state = consult('Yes', trip);
  assert.equal(hasConfirmedAdultParty({ ...defaultBrief(), consultation: state }), true);
  assert.deepEqual(state.party, {
    hasChildren: false,
    childAges: [],
    source: 'message',
    evidence: 'Yes',
  });
  assert.equal(
    hasConfirmedAdultParty({
      ...defaultBrief(),
      consultation: consult('Yes', withQuestion('Would you like flights?')),
    }),
    false,
  );
  assert.equal(
    hasConfirmedAdultParty({
      ...defaultBrief(),
      consultation: consult(
        'Yes',
        withQuestion('Are all travellers adults? Would you like flights?'),
      ),
    }),
    false,
  );
});

test('an explicit no-children reply confirms adult composition and clears a previous child mix', () => {
  const trip = withState(consult('Two adults and one child aged 8'));
  const state = consult('No children', trip);
  assert.equal(hasConfirmedAdultParty({ ...defaultBrief(), consultation: state }), true);
  assert.equal(hasUnsupportedParty({ ...defaultBrief(), consultation: state }), false);
  assert.deepEqual(state.party?.childAges, []);
  assert.equal(state.party?.evidence, 'No children');
});

test('holiday dates do not imply a flight journey, and invented flight dates are discarded', () => {
  const trip = newTrip();
  trip.startDate = '2026-11-18';
  const message = 'Find return flights for me';
  const state = consult(message, trip, {
    ...emptyUpdates(),
    flightJourney: {
      type: 'return',
      departureDate: '2026-11-18',
      returnDate: '2026-11-22',
      cabinClass: 'economy',
      evidence: message,
    },
  });
  assert.equal(state.flightJourney?.type, 'return');
  assert.equal(state.flightJourney?.departureDate, '');
  assert.equal(state.flightJourney?.returnDate, '');
  for (const field of [
    'destination',
    'dates',
    'duration',
    'travelers',
    'budget',
    'interests',
    'origin',
  ] as const)
    state.facts[field] = { source: 'form', evidence: 'Customer settings', valueState: 'specified' };
  state.services.hotels = { status: 'not_needed', source: 'form' };
  assert.deepEqual(
    getConsultationQuestions(trip, { ...defaultBrief(), consultation: state }).map((q) => q.field),
    ['flight_dates'],
  );
});

test('explicit flight dates are preserved across follow-ups and one-way corrections clear return dates', () => {
  const message = 'Return flights departing November 18, 2026 and back November 25, 2026';
  let state = consult(message, newTrip(), {
    ...emptyUpdates(),
    flightJourney: {
      type: 'return',
      departureDate: '2026-11-18',
      returnDate: '2026-11-25',
      cabinClass: 'economy',
      evidence: message,
    },
  });
  assert.equal(state.flightJourney?.departureDate, '2026-11-18');
  assert.equal(state.flightJourney?.returnDate, '2026-11-25');
  state = consult('More nature, please.', withState(state));
  assert.equal(state.flightJourney?.returnDate, '2026-11-25');
  const correction = 'Actually one-way flights, no return.';
  state = consult(correction, withState(state), {
    ...emptyUpdates(),
    flightJourney: {
      type: 'one_way',
      departureDate: '',
      returnDate: '',
      cabinClass: 'economy',
      evidence: correction,
    },
  });
  assert.equal(state.flightJourney?.type, 'one_way');
  assert.equal(state.flightJourney?.departureDate, '2026-11-18');
  assert.equal(state.flightJourney?.returnDate, '');
});

test('consultation schema is bounded and backward-compatible with saved briefs', () => {
  assert.equal(travelBriefSchema.safeParse(defaultBrief()).success, true);
  assert.equal(
    travelBriefSchema.safeParse({ ...defaultBrief(), consultation: defaultConsultation() }).success,
    true,
  );
  assert.equal(
    consultationSchema.safeParse({ ...defaultConsultation(), currency: 'Australian dollars' })
      .success,
    false,
  );
  assert.equal(
    consultationSchema.safeParse({
      ...defaultConsultation(),
      facts: { passport: { source: 'form', evidence: 'secret', valueState: 'specified' } },
    }).success,
    false,
  );
  assert.equal(
    consultationSchema.safeParse({
      ...defaultConsultation(),
      route: [
        { name: 'London', days: 21 },
        { name: 'Paris', days: 21 },
      ],
    }).success,
    false,
  );
});
