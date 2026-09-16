import { randomUUID } from 'node:crypto';
import { destinations, experiences } from '../shared/catalog.ts';
import type { Trip, ItineraryDay, ItineraryItem, Destination } from '../shared/types.ts';
import { dateSchema } from './validation.ts';
import { findDestination } from '../shared/destinations.ts';

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
const keywords: Record<string, RegExp> = {
  Food: /\b(food|foodie|restaurant|cuisine|eat|cooking|culinary)\b/i,
  Culture: /\b(culture|cultural|art|museum|history|historic|temple|architecture)\b/i,
  Nature: /\b(nature|hike|hiking|outdoors|wildlife|mountain|forest)\b/i,
  Beaches: /\b(beach|beaches|ocean|surf|swim|water|coast)\b/i,
  Relaxation: /\b(relax|relaxing|slow|spa|wellness|peaceful|yoga)\b/i,
  Adventure: /\b(adventure|adventurous|dive|diving|kayak|active)\b/i,
  Romance: /\b(romantic|romance|honeymoon|couple|anniversary)\b/i,
  Family: /\b(family|children|kids|child)\b/i,
};

export function matchDestination(message: string) {
  const input = normalize(message);
  const containsName = (name: string) =>
    new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${normalize(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`,
      'u',
    ).test(input);
  const direct = destinations.find((d) => [d.name, d.id.replaceAll('-', ' ')].some(containsName));
  if (direct) return direct;
  const countryMatches = destinations.filter((d) => containsName(d.country));
  return countryMatches.length === 1 ? countryMatches[0] : undefined;
}

export type DestinationIntent =
  | { kind: 'explicit'; name: string; destination?: Destination }
  | { kind: 'discovery' }
  | { kind: 'unspecified' };

/** Parse place-directed language without treating every interest as a destination search. */
export function detectDestinationIntent(message: string): DestinationIntent {
  const placeWords = String.raw`[\p{L}][\p{L}\p{M}'’.-]*(?:\s+[\p{L}][\p{L}\p{M}'’.-]*){0,6}`;
  // These are non-place phrases, not a list of supported or unsupported cities.
  const genericStart =
    /^(?:a|an|the|my|our|your|i|we|it|me|us|some|any|somewhere|anywhere|where|what|which|this|next|for|with|without|and|quiet|peaceful|food|vegetarian|vegan|step-free|accessible|relaxing|relaxed|slow|slower|romantic|cheap|cheaper|affordable|budget|beach|beaches|city|cities|nature|culture|cultural|mountains?|places?|destinations?|trip|travel|vacation|holiday|plan|make|suggest|recommend|find|choose|pick|want|like|love|prefer|eat|see|do|have|enjoy|spend|explore|visit|go|get|be|stay|switch|change|extend|shorten|lengthen|postpone|reschedule|adjust|update|cancel|add|remove|include|skip|avoid|less|more|shorter|longer|walk|walking|start|starts|starting|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
  const activityWords =
    /\b(?:breakfast|lunch|dinner|meals?|restaurants?|caf[eé]s?|museums?|parks?|markets?|activities|activity|stops?|hotels?)\b/i;
  const cleanName = (value: string) => {
    const name = value
      .split(
        /\s+\b(?:for|from|starting|start|on|with|without|during|between|and|then|via|please|instead|next|this|in|to|budget|we|i|who|where|that|which|itinerary|trip|vacation|holiday)\b|[.!?](?:\s|$)/i,
      )[0]
      .replace(/[.\s]+$/, '')
      .trim();
    return name &&
      !genericStart.test(name) &&
      !activityWords.test(name) &&
      !/\b(?:days?|nights?|weeks?|weekend)\b/i.test(name)
      ? name
      : undefined;
  };
  const directed = new RegExp(
    String.raw`(?=\b(?:(?:in|to|around)\s+|(?:visit(?:ing)?|explore|tour(?:ing)?|plan(?:ning)?)\s+|(?:destination|city)\s*(?:is|:|=)\s*)(${placeWords}))`,
    'giu',
  );
  for (const match of message.matchAll(directed)) {
    const name = cleanName(match[1]);
    if (!name) continue;
    const destination = matchDestination(name);
    if (destination) return { kind: 'explicit', name, destination };
    const prefix =
      message
        .slice(0, match.index)
        .split(/[.!?\n]/)
        .at(-1) || '';
    const travelContext =
      /\b(?:days?|nights?|weeks?|weekend|trip|itinerary|vacation|holiday|travel(?:l?ing)?|journey|honeymoon|escape|go(?:ing)?|fly(?:ing)?|head(?:ing)?|destination|city|switch|change)\b/i.test(
        prefix,
      );
    const startsPlan = /^plan(?:ning)?\b/i.test(message.slice(match.index));
    const visitWithDuration =
      /^(?:visit(?:ing)?|explore|tour(?:ing)?)\b/i.test(message.slice(match.index)) &&
      /\b(?:\d+|one|two|three|four|five|six|seven)\s*(?:days?|nights?|weeks?)\b/i.test(message);
    // A neighborhood or venue in an activity request is not a trip destination change.
    if (!activityWords.test(prefix) && (travelContext || startsPlan || visitWithDuration))
      return { kind: 'explicit', name };
  }
  const direct = matchDestination(message);
  if (direct) return { kind: 'explicit', name: direct.name, destination: direct };
  // A duration makes "Osaka for 4 days" unambiguous; bare "Birthday dinner" is not a city.
  const leading = message.match(
    new RegExp(
      String.raw`^\s*(${placeWords})\s+(?:for\s+)?(?:\d{1,2}|one|two|three|four|five|six|seven)\s*(?:days?|nights?|weeks?)\b`,
      'iu',
    ),
  );
  const leadingName = leading && cleanName(leading[1]);
  if (leadingName && leadingName.split(/\s+/).length <= 4)
    return { kind: 'explicit', name: leadingName, destination: matchDestination(leadingName) };
  const discovery =
    /\b(?:somewhere|anywhere|surprise me|not sure where|undecided)\b|\bwhere\b.{0,50}\b(?:go|travel|visit|holiday|vacation)\b|\b(?:suggest|recommend|find|choose|pick)\b.{0,50}\b(?:destinations?|places?|cities|city|escape|trip|holiday|vacation)\b|\b(?:beach|city|nature|food|relaxing|romantic)\b.{0,30}\b(?:escape|getaway|break|trip|holiday|vacation)\b/i.test(
      message,
    );
  return { kind: discovery ? 'discovery' : 'unspecified' };
}

export function newTrip(): Trip {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: 'My next adventure',
    destinationId: '',
    startDate: '',
    days: 5,
    travelers: 2,
    budget: 1500,
    interests: [],
    status: 'draft',
    itinerary: [],
    messages: [],
    shareToken: null,
    createdAt: now,
    updatedAt: now,
  };
}

function item(
  time: string,
  title: string,
  description: string,
  location: string,
  category: ItineraryItem['category'],
  cost = 0,
): ItineraryItem {
  return { id: randomUUID(), time, title, description, location, category, cost, completed: false };
}

export function generateItinerary(trip: Trip): ItineraryDay[] {
  const destination = findDestination(trip.destinationId, trip);
  if (!destination) return [];
  const options = experiences.filter((e) => e.destinationId === destination.id);
  const interestText = trip.interests.join(' ').toLowerCase();
  options.sort(
    (a, b) =>
      Number(interestText.includes(b.category.toLowerCase())) -
      Number(interestText.includes(a.category.toLowerCase())),
  );
  const daily = trip.budget / trip.days / trip.travelers;
  const relaxed = /relaxation|romance/.test(interestText);
  const food = /food/.test(interestText);
  const sights = destination.highlights;
  return Array.from({ length: trip.days }, (_, index) => {
    const highlight = sights[index % sights.length] || destination.name;
    const extra = sights[(index + 1) % sights.length] || destination.name;
    const experience = options[index % Math.max(options.length, 1)];
    const dayItems: ItineraryItem[] = [
      item(
        '09:00',
        index === 0
          ? `A first taste of ${destination.name}`
          : `A slow morning in ${destination.name}`,
        `Start with breakfast and leave time to find your bearings. Budget around $${Math.max(5, Math.round(daily * 0.08))} per person; this is a planning estimate.`,
        destination.name,
        'food',
        Math.max(5, Math.round(daily * 0.08)),
      ),
      item(
        '10:30',
        index < sights.length ? highlight : `Explore more of ${highlight}`,
        `Make time for ${highlight}. Check local opening hours, access requirements, and transport before you go.`,
        highlight,
        'sight',
        Math.round(daily * 0.08),
      ),
      item(
        '13:00',
        food ? 'Follow your appetite' : 'A little lunch break',
        food
          ? 'Explore local dishes at a neighborhood restaurant or market. Ask about ingredients and dietary needs before ordering.'
          : 'Find a nearby café or local restaurant and keep the afternoon flexible.',
        destination.name,
        'food',
        Math.max(8, Math.round(daily * 0.12)),
      ),
    ];
    if (!relaxed && experience && experience.price <= daily * 0.55) {
      dayItems.push(
        item(
          '15:00',
          experience.name,
          experience.description +
            ' This is an inspiration idea; confirm the operator, schedule and final price directly.',
          destination.name,
          'experience',
          experience.price,
        ),
      );
    } else {
      dayItems.push(
        item(
          '15:00',
          relaxed ? 'Room to do a little less' : `An afternoon around ${extra}`,
          relaxed
            ? 'Take an unhurried walk, stop for a drink, or settle into a quiet spot. This afternoon is yours.'
            : `Explore the area around ${extra} at your own pace. Allow extra time for getting there.`,
          relaxed ? destination.name : extra,
          'leisure',
          Math.round(daily * 0.04),
        ),
      );
    }
    dayItems.push(
      item(
        '18:30',
        index === trip.days - 1 ? 'One last lovely evening' : 'Dinner, your way',
        'Choose a local spot for dinner. Reserve directly where needed; no reservation has been made.',
        destination.name,
        'food',
        Math.max(10, Math.round(daily * 0.16)),
      ),
    );
    return {
      day: index + 1,
      title:
        index === 0
          ? `Hello, ${destination.name}`
          : index === trip.days - 1
            ? 'A little more to remember'
            : `${highlight} & little discoveries`,
      items: dayItems,
    };
  });
}

function extractDate(message: string): string | undefined {
  const iso = message.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (iso && dateSchema.safeParse(iso).success) return iso;
  const words = message.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/i,
  );
  if (words) {
    const current = new Date();
    const year = Number(words[3] || current.getFullYear());
    const parsed = new Date(`${words[1]} ${words[2]}, ${year} 12:00:00 UTC`);
    if (!Number.isNaN(parsed.valueOf()) && parsed.getUTCDate() === Number(words[2])) {
      if (!words[3] && parsed < current) parsed.setUTCFullYear(year + 1);
      const date = parsed.toISOString().slice(0, 10);
      if (dateSchema.safeParse(date).success) return date;
    }
  }
  return undefined;
}

function suggestDestinations(trip: Trip, message: string): Destination[] {
  const interests = new Set(trip.interests);
  const cityBreak = /\b(city|cities|urban|cafes?|cafés?)\b/i.test(message);
  const natureBreak =
    interests.has('Nature') ||
    interests.has('Adventure') ||
    /\b(wild|mountains?|trails?)\b/i.test(message);
  const beachBreak =
    interests.has('Beaches') || /\b(seaside|coastal|tropical|island)\b/i.test(message);
  const cultureBreak = interests.has('Culture');
  const affordable = /\b(cheap|cheaper|affordable|budget|inexpensive)\b|\$|\bUSD\b/i.test(message);
  if (!interests.size && !cityBreak && !natureBreak && !beachBreak && !affordable) return [];
  const dailyTarget = trip.budget / trip.days / trip.travelers;
  return destinations
    .map((destination) => {
      const text = normalize(
        [
          destination.vibe,
          ...destination.tags,
          destination.description,
          ...destination.highlights,
        ].join(' '),
      );
      let score = 0;
      // A named landscape is a stronger constraint than secondary interests.
      if (beachBreak) {
        if (!/beach|coast|ocean|tropical/.test(text)) return { destination, score: -Infinity };
        score += destination.vibe === 'By the water' ? 10 : 7;
      }
      if (natureBreak)
        score +=
          destination.vibe === 'Into the wild'
            ? 9
            : /mountain|trail|nature|forest/.test(text)
              ? 4
              : 0;
      if (cityBreak)
        score += destination.vibe === 'City escapes' ? 9 : /city|urban/.test(text) ? 3 : 0;
      if (cultureBreak)
        score +=
          destination.vibe === 'Culture & charm'
            ? 9
            : /art|historic|museum|temple/.test(text)
              ? 4
              : 0;
      if (interests.has('Food') && /food|cafe|cuisine|market|bakery/.test(text)) score += 4;
      if (interests.has('Relaxation') && /slow|wellness|quiet|peaceful|coast/.test(text))
        score += 4;
      if (interests.has('Romance') && /romantic|coast|slow|quiet/.test(text)) score += 4;
      if (interests.has('Family') && /garden|nature|beach|outdoor/.test(text)) score += 3;
      if (affordable)
        score += Math.max(
          -6,
          Math.min(5, ((dailyTarget - destination.dailyBudget) / Math.max(dailyTarget, 1)) * 5),
        );
      return { destination, score };
    })
    .filter(({ score }) => Number.isFinite(score) && (score > 0 || affordable))
    .sort((a, b) => b.score - a.score || a.destination.dailyBudget - b.destination.dailyBudget)
    .slice(0, 3)
    .map(({ destination }) => destination);
}

export function localPlan(original: Trip, message: string): { trip: Trip; reply: string } {
  const trip = structuredClone(original);
  const intent = detectDestinationIntent(message);
  const destination = intent.kind === 'explicit' ? intent.destination : undefined;
  if (intent.kind === 'explicit' && !destination && original.destinationId)
    return {
      trip,
      reply: `You asked to plan ${intent.name}, which is not covered by the local planner yet. Your existing itinerary is still saved as it was. I haven't substituted another destination. Would you like to keep your current trip or choose a supported destination?`,
    };
  const previousDestination = trip.destinationId;
  if (destination) {
    trip.destinationId = destination.id;
    if (destination.id !== previousDestination)
      trip.title = `A little escape to ${destination.name}`;
  } else if (intent.kind === 'explicit') {
    trip.destinationId = '';
    trip.itinerary = [];
    trip.title = `A trip to ${intent.name}`.slice(0, 120);
  }
  const text = message
    .replace(/\bone\b/gi, '1')
    .replace(/\btwo\b/gi, '2')
    .replace(/\bthree\b/gi, '3')
    .replace(/\bfour\b/gi, '4')
    .replace(/\bfive\b/gi, '5')
    .replace(/\bsix\b/gi, '6')
    .replace(/\bseven\b/gi, '7')
    .replace(/\bten\b/gi, '10');
  let duration = text.match(/\b(\d{1,2})[ -]?(?:days?|nights?)\b/i)?.[1];
  const weeks = text.match(/\b(\d{1,2})[ -]?weeks?\b/i)?.[1];
  if (!duration && weeks) duration = String(Number(weeks) * 7);
  if (!duration && /\b(?:a |1 |one )?week\b/i.test(text)) duration = '7';
  if (!duration && /\bweekend\b/i.test(text)) duration = '3';
  if (duration) trip.days = Math.max(1, Math.min(21, Number(duration)));
  const people =
    text.match(
      /\b(\d{1,2})\s*(?:people|persons?|travelers?|travellers?|adults?|guests?)\b/i,
    )?.[1] ?? text.match(/\b(?:for|party of)\s+(\d{1,2})\b/i)?.[1];
  if (people && !new RegExp(`for\\s+${people}[ -]*(?:days?|nights?|weeks?)`, 'i').test(text))
    trip.travelers = Math.max(1, Math.min(16, Number(people)));
  if (/\bsolo\b/i.test(text)) trip.travelers = 1;
  const money = text.match(/(?:\$|USD\s*|budget\s*(?:of|is|:|to)?\s*)\s*([\d,]+(?:\.\d+)?)(k)?/i);
  if (money) {
    const value = Number(money[1].replaceAll(',', '')) * (money[2] ? 1000 : 1);
    trip.budget = Math.min(
      1_000_000,
      value *
        (/per day|a day|daily/i.test(text) ? trip.days : 1) *
        (/per person|each person/i.test(text) ? trip.travelers : 1),
    );
  } else if (/\b(cheaper|lower.*budget|on a budget|budget.friendly)\b/i.test(text))
    trip.budget = Math.round(trip.budget * 0.7);
  else if (!original.destinationId && !original.messages.length && destination)
    trip.budget = destination.dailyBudget * trip.days * trip.travelers;
  const date = extractDate(message);
  if (date) trip.startDate = date;
  for (const [interest, matcher] of Object.entries(keywords)) {
    if (!matcher.test(message)) continue;
    const excluded = new RegExp(
      `(?:no|less|without|skip|avoid|remove)\\s+(?:\\w+\\s+)?${matcher.source.replace(/\\b/g, '')}`,
      'i',
    ).test(message);
    trip.interests = trip.interests.filter((value) => value !== interest);
    if (!excluded) trip.interests.push(interest);
  }
  const changed =
    !trip.itinerary.length ||
    ['destinationId', 'days', 'budget', 'travelers'].some(
      (key) => trip[key as keyof Trip] !== original[key as keyof Trip],
    ) ||
    trip.interests.join() !== original.interests.join();
  if (changed && trip.destinationId) trip.itinerary = generateItinerary(trip);
  trip.updatedAt = new Date().toISOString();
  if (!trip.destinationId) {
    if (intent.kind === 'explicit')
      return {
        trip,
        reply: `You asked for ${trip.days} days in ${intent.name}${trip.startDate ? ` starting ${trip.startDate}` : ''}, for ${trip.travelers} ${trip.travelers === 1 ? 'traveler' : 'travelers'}. ${intent.name} is not covered by the local planner yet, so I haven't built an itinerary for another city. Your request and preferences are saved. Which one of the supported destinations would you like to explore, or would you prefer to keep this draft for ${intent.name}?`,
      };
    const suggestions = intent.kind === 'discovery' ? suggestDestinations(trip, message) : [];
    if (suggestions.length) {
      const defaultBudget = !money && !original.messages.length && original.budget === 1500;
      const ideas = suggestions
        .map(
          (place, index) =>
            `${index + 1}. ${place.name}, ${place.country} — ${place.description} Around $${place.dailyBudget} per person per day as a planning guide.`,
        )
        .join('\n\n');
      return {
        trip,
        reply: `A few places come to mind for your ${trip.days}-day escape:\n\n${ideas}\n\nWhich one feels like your kind of trip? Choose a destination and I'll build the itinerary around your ${trip.travelers} ${trip.travelers === 1 ? 'traveler' : 'travelers'} and ${money ? 'your' : defaultBudget ? 'the current default' : 'the current'} $${trip.budget.toLocaleString('en-US')} total planning budget.${defaultBudget ? ' Tell me your actual budget to replace this default.' : ''} These are illustrative destination budgets, not live quotes; flights are separate. I haven't picked a destination or booked anything.`,
      };
    }
    return {
      trip,
      reply: `I'd love to help you find your next escape. The local planner currently covers ${destinations.map((d) => d.name).join(', ')}. Which one would you like to explore? Tell me how many days you have, your budget in USD, and who is coming along.`,
    };
  }
  const place = findDestination(trip.destinationId, trip)!;
  const knownChange = changed || date;
  const intro = original.itinerary.length
    ? knownChange
      ? `I've updated your ${trip.days}-day ${place.name} plan.`
      : `Your ${trip.days}-day ${place.name} plan is ready to explore.`
    : `Let's make ${place.name} yours. I've put together ${trip.days} days with a little room for discovery.`;
  const details = `The plan is for ${trip.travelers} ${trip.travelers === 1 ? 'traveler' : 'travelers'}, with ${!money && !original.destinationId && !original.messages.length ? 'an estimated' : 'a current'} total planning budget of $${trip.budget.toLocaleString('en-US')}${trip.startDate ? `, starting ${trip.startDate}` : ''}.${trip.interests.length ? ` I've kept ${trip.interests.join(', ').toLowerCase()} in mind.` : ''}`;
  const help =
    !knownChange && original.itinerary.length
      ? ' The local planner understands destinations, day counts, dates like 2026-12-10, traveler counts, dollar budgets, and interests. For a specific activity, use the itinerary editor.'
      : 'You can change the dates, make it slower, adjust the budget, or edit any stop in your itinerary.';
  return {
    trip,
    reply: `${intro}\n\n${details}\n\n${help}\n\nAll costs are planning estimates in USD. Flights and accommodation are separate; nothing is booked.`,
  };
}
