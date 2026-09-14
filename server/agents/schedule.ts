import { randomUUID } from 'node:crypto';
import { findDestination } from '../../shared/destinations.ts';
import type { ItineraryDay, ItineraryItem, Trip } from '../../shared/types.ts';
import type { PlanningPlace, TravelBrief } from '../../shared/planning.ts';
import { curatedPlaces, distanceKm } from './places.ts';

export class PlanningConstraintError extends Error {
  status = 409;
  code = 'LOCKED_DAY';
}

export const defaultBrief = (): TravelBrief => ({
  pace: 'balanced',
  originAirport: '',
  arrivalAirport: '',
  guestNationality: '',
  includeFlights: false,
  includeHotels: false,
  destinationStops: [],
  notes: [],
});

export const minuteOfDay = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const duration = (item: ItineraryItem) => item.durationMinutes || 60;
const excerpt = (text: string, limit: number) => {
  if (text.length <= limit) return text;
  const shortened = text.slice(0, limit - 1);
  const end = shortened.lastIndexOf(' ');
  return `${shortened.slice(0, end > limit * 0.7 ? end : undefined)}…`;
};

export interface CompositionDay {
  day: number;
  title: string;
  placeIds: string[];
  note: string;
}

/** Allocate only destinations resolved for this trip or in the featured collection. */
export function allocatedStops(trip: Trip, brief = trip.brief || defaultBrief()) {
  const supported = brief.destinationStops.filter((stop) =>
    Boolean(findDestination(stop.destinationId, trip)),
  );
  if (!supported.length)
    return findDestination(trip.destinationId, trip)
      ? [{ destinationId: trip.destinationId, days: trip.days }]
      : [];
  if (supported.reduce((sum, stop) => sum + stop.days, 0) === trip.days) return supported;
  const feasible = supported.slice(0, trip.days);
  let remaining = trip.days;
  return feasible.map((stop, index) => {
    const days =
      index === feasible.length - 1
        ? remaining
        : Math.max(1, Math.min(stop.days, remaining - (feasible.length - index - 1)));
    remaining -= days;
    return { ...stop, days };
  });
}

function scheduleItem(
  time: string,
  title: string,
  description: string,
  location: string,
  category: ItineraryItem['category'],
  cost = 0,
  durationMinutes = 60,
): ItineraryItem {
  return {
    id: randomUUID(),
    time,
    title: excerpt(title, 160),
    description: excerpt(description, 1200),
    location: excerpt(location, 200),
    category,
    cost,
    durationMinutes,
    travelMinutes: 0,
    completed: false,
  };
}

function stopItem(place: PlanningPlace, minute: number, travelMinutes: number) {
  const item = scheduleItem(
    clock(minute),
    place.name,
    `Allow around ${place.durationMinutes} minutes. Cost and duration are planning estimates; confirm access and tickets directly. ${place.description || (place.sourceId.startsWith('google-') ? 'Place details supplied by Google Places.' : place.evidenceUrls?.length ? 'Suggested from web research.' : 'Curated inspiration.')}${place.suitability?.length ? ` ${place.suitability[0]}` : ''}`,
    place.address,
    place.category,
    place.estimatedCost,
    place.durationMinutes,
  );
  return { ...item, placeId: place.id, sourceId: place.sourceId, travelMinutes };
}

/** Build a realistic time grid around grounded places, leaving explicit unfilled discovery time. */
export function buildLocalItinerary(
  trip: Trip,
  brief = trip.brief || defaultBrief(),
  researchedPlaces?: PlanningPlace[],
  composition?: CompositionDay[],
): ItineraryDay[] {
  const stops = allocatedStops(trip, brief);
  const places = researchedPlaces || curatedPlaces(stops.map((stop) => stop.destinationId));
  const used = new Set<string>();
  const days: ItineraryDay[] = [];
  for (const stop of stops) {
    const destination = findDestination(stop.destinationId, trip);
    if (!destination) continue;
    const options = places.filter((place) => place.destinationId === stop.destinationId);
    // The catalogue/place ledger is USD; an AUD target is not an exchange rate.
    const comparableBudget =
      !brief.consultation ||
      (brief.consultation.currency === 'USD' &&
        brief.consultation.facts.budget?.valueState === 'specified');
    const targetDaily = comparableBudget
      ? trip.budget / Math.max(1, trip.days * trip.travelers)
      : destination.dailyBudget;
    const spendDaily = Math.min(destination.dailyBudget, targetDaily);
    const foodCost = (fraction: number, floor: number) =>
      Math.max(floor, Math.round(spendDaily * fraction));
    for (let offset = 0; offset < stop.days && days.length < trip.days; offset++) {
      const day = days.length + 1;
      const chosen = composition?.find((entry) => entry.day === day);
      const transfer = offset === 0 && day > 1;
      const dayItems: ItineraryItem[] = [];
      if (transfer) {
        const previous = findDestination(days.at(-1)?.destinationId || '', trip);
        dayItems.push(
          scheduleItem(
            '09:00',
            `Travel to ${destination.name}`,
            `Reserve this day for travel from ${previous?.name || 'your previous stop'}. This is a placeholder: choose transport, confirm its duration, and allow time for check-out, border checks if relevant, and check-in. No connection has been booked.`,
            destination.name,
            'leisure',
            0,
            420,
          ),
        );
        dayItems.push(
          scheduleItem(
            '16:30',
            `Settle into ${destination.name}`,
            'Leave space for delays and getting your bearings. Move this block once your transport is confirmed.',
            destination.name,
            'leisure',
            0,
            90,
          ),
        );
        dayItems.push(
          scheduleItem(
            '19:00',
            `An easy first dinner in ${destination.name}`,
            'Choose somewhere close to your accommodation and keep the evening flexible.',
            destination.name,
            'food',
            foodCost(0.16, 10),
            75,
          ),
        );
      } else {
        dayItems.push(
          scheduleItem(
            '09:00',
            offset === 0
              ? `A first taste of ${destination.name}`
              : `Breakfast & a fresh start — day ${day}`,
            'Breakfast at your own pace. Food prices are planning allowances per person, not restaurant quotes.',
            destination.name,
            'food',
            foodCost(0.08, 5),
          ),
        );
        const available = options.filter(
          (place) =>
            !used.has(place.id) &&
            (!chosen || chosen.placeIds.includes(place.id)) &&
            (Boolean(chosen) || place.estimatedCost <= Math.max(8, spendDaily * 0.3)),
        );
        const preferredIds = chosen?.placeIds || [];
        available.sort((a, b) => {
          const ai = preferredIds.indexOf(a.id),
            bi = preferredIds.indexOf(b.id);
          if (ai !== -1 || bi !== -1)
            return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
          return (
            Number(b.sourceId.startsWith('google-')) - Number(a.sourceId.startsWith('google-'))
          );
        });
        const morning =
          available.find((place) => place.category !== 'food' && place.category !== 'experience') ||
          available[0];
        const morningStart = brief.pace === 'relaxed' ? 660 : 630;
        if (morning) {
          used.add(morning.id);
          dayItems.push(stopItem(morning, morningStart, 30));
        } else {
          dayItems.push(
            scheduleItem(
              clock(morningStart),
              `Your own discoveries — day ${day}`,
              `The researched suggestions have been used once. Keep this morning free to explore ${destination.name}; add a specific stop when you find one you like.`,
              destination.name,
              'leisure',
              0,
              90,
            ),
          );
        }
        const lunchTime = Math.max(780, morningStart + (morning?.durationMinutes || 90) + 30);
        const restaurant = available.find(
          (place) => place.category === 'food' && !used.has(place.id),
        );
        if (restaurant) {
          used.add(restaurant.id);
          dayItems.push(stopItem(restaurant, lunchTime, 30));
        } else
          dayItems.push(
            scheduleItem(
              clock(lunchTime),
              `A neighborhood lunch — day ${day}`,
              'Find a nearby café or market. Check menus for dietary needs and reserve directly if needed.',
              destination.name,
              'food',
              foodCost(0.12, 8),
              60,
            ),
          );
        if (
          brief.pace !== 'relaxed' ||
          (chosen && available.some((place) => !used.has(place.id) && place.category !== 'food'))
        ) {
          const afternoonOptions = available.filter(
            (place) => !used.has(place.id) && place.category !== 'food',
          );
          if (morning?.coordinates)
            afternoonOptions.sort((a, b) => {
              if (preferredIds.includes(a.id) || preferredIds.includes(b.id))
                return preferredIds.indexOf(a.id) === -1
                  ? 1
                  : preferredIds.indexOf(b.id) === -1
                    ? -1
                    : preferredIds.indexOf(a.id) - preferredIds.indexOf(b.id);
              return (
                (a.coordinates ? distanceKm(morning.coordinates!, a.coordinates) : 1000) -
                (b.coordinates ? distanceKm(morning.coordinates!, b.coordinates) : 1000)
              );
            });
          // Balanced itineraries save researched places for later days. Active plans use two.
          const daysRemainingHere = stop.days - offset - 1;
          const afternoon =
            chosen || brief.pace === 'active' || afternoonOptions.length > daysRemainingHere
              ? afternoonOptions[0]
              : undefined;
          const travel =
            morning?.coordinates && afternoon?.coordinates
              ? Math.min(
                  180,
                  Math.max(
                    20,
                    Math.ceil(
                      ((distanceKm(morning.coordinates, afternoon.coordinates) / 18) * 60) / 5,
                    ) * 5,
                  ),
                )
              : 30;
          const afternoonTime = Math.max(900, lunchTime + 60 + travel);
          if (afternoon && afternoonTime + afternoon.durationMinutes <= 1110) {
            used.add(afternoon.id);
            dayItems.push(stopItem(afternoon, afternoonTime, travel));
          } else
            dayItems.push(
              scheduleItem(
                clock(Math.min(1020, afternoonTime)),
                `Leave a little room — day ${day}`,
                chosen?.note ||
                  'Unscheduled time for an unhurried walk, a café, or a discovery of your own. No activity is reserved.',
                destination.name,
                'leisure',
                0,
                60,
              ),
            );
        }
        const last = dayItems.at(-1)!;
        const dinnerTime = Math.max(1110, minuteOfDay(last.time) + duration(last) + 30);
        const dinner = available.find((place) => place.category === 'food' && !used.has(place.id));
        if (dinner) {
          used.add(dinner.id);
          dayItems.push(stopItem(dinner, dinnerTime, 30));
        } else
          dayItems.push(
            scheduleItem(
              clock(dinnerTime),
              day === trip.days ? 'One last lovely evening' : `Dinner, your way — day ${day}`,
              'Choose a local spot for dinner. Reserve directly where needed; no reservation has been made.',
              destination.name,
              'food',
              foodCost(0.16, 10),
              75,
            ),
          );
      }
      if (chosen?.note && dayItems.length) {
        const explained = dayItems.find((item) => item.placeId) || dayItems[0];
        explained.description = excerpt(`${chosen.note}\n\n${explained.description}`, 1200);
      }
      days.push({
        day,
        destinationId: destination.id,
        title: transfer
          ? `Onward to ${destination.name}`
          : chosen?.title ||
            (offset === 0
              ? `Hello, ${destination.name}`
              : dayItems.find((item) => item.placeId)?.title ||
                `A little more of ${destination.name}`),
        items: dayItems,
      });
    }
  }
  return days;
}

/** Pinned activities keep their exact day, ID, content and time; generated blocks move or drop around them. */
export function preserveLockedStops(original: Trip, candidate: Trip): Trip {
  const result = structuredClone(candidate);
  const locked = original.itinerary.flatMap((day) =>
    day.items.filter((item) => item.locked).map((item) => ({ day: day.day, item })),
  );
  const lastLockedDay = Math.max(0, ...locked.map((entry) => entry.day));
  if (lastLockedDay > result.days)
    throw new PlanningConstraintError(
      `Day ${lastLockedDay} contains a protected stop. Unlock or move it before shortening your trip.`,
    );
  for (const pin of locked) {
    const originalDestination =
      original.itinerary.find((day) => day.day === pin.day)?.destinationId ||
      original.destinationId;
    const candidateDestination =
      result.itinerary.find((day) => day.day === pin.day)?.destinationId || result.destinationId;
    if (originalDestination !== candidateDestination)
      throw new PlanningConstraintError(
        `Day ${pin.day} contains a protected stop in your earlier destination. Unlock or move it before changing this day's destination.`,
      );
  }
  for (const day of result.itinerary) {
    day.items = day.items.filter(
      (item) =>
        !item.placeId ||
        !locked.some((pin) => pin.item.placeId === item.placeId && pin.item.id !== item.id),
    );
    const pinned = locked
      .filter((entry) => entry.day === day.day)
      .map((entry) => structuredClone(entry.item));
    if (!pinned.length) continue;
    const occupied = pinned.map((entry) => ({
      start: minuteOfDay(entry.time),
      end: minuteOfDay(entry.time) + duration(entry),
    }));
    const free = day.items.filter(
      (entry) =>
        !locked.some(
          (pin) =>
            pin.item.id === entry.id || (pin.day === day.day && pin.item.title === entry.title),
        ),
    );
    const items = [...pinned];
    for (const entry of free) {
      if (items.length >= 16) break;
      let start = minuteOfDay(entry.time);
      for (const block of occupied.sort((a, b) => a.start - b.start))
        if (start < block.end + 15 && start + duration(entry) + 15 > block.start)
          start = block.end + 15;
      if (start + duration(entry) > 1320) continue;
      entry.time = clock(start);
      items.push(entry);
      occupied.push({ start, end: start + duration(entry) });
    }
    day.items = items.sort((a, b) => minuteOfDay(a.time) - minuteOfDay(b.time));
  }
  return result;
}
