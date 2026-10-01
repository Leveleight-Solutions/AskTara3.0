import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Flex,
  Grid,
  Heading,
  IconButton,
  Reset,
  Select,
  Text,
  TextField,
} from '@radix-ui/themes';
import { BedDouble, ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import {
  filterHotelQuotes,
  type HotelPhoto,
  type StudioHotelQuote,
  type StudioHotelSearchResult,
} from '../../shared/studio-hotels';
import { readableDate } from '../api';

function PhotoCarousel({ photos, label }: { photos: HotelPhoto[]; label: string }) {
  const [index, setIndex] = useState(0),
    [failed, setFailed] = useState<string[]>([]);
  const available = photos.filter((photo) => !failed.includes(photo.url));
  const photo = available[index % Math.max(1, available.length)];
  return (
    <Box
      style={{
        position: 'relative',
        background: 'var(--gray-3)',
        borderRadius: 8,
        overflow: 'hidden',
        minHeight: 170,
      }}
    >
      {photo ? (
        <img
          src={photo.url}
          alt={photo.caption || label}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed((old) => [...old, photo.url])}
          style={{ width: '100%', height: 190, display: 'block', objectFit: 'cover' }}
        />
      ) : (
        <Flex align="center" justify="center" direction="column" gap="2" style={{ height: 190 }}>
          <BedDouble size={28} />
          <Text size="1" color="gray">
            Photos unavailable
          </Text>
        </Flex>
      )}
      {available.length > 1 && (
        <Flex
          justify="between"
          align="center"
          p="2"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            background: 'rgba(0,0,0,.5)',
            color: 'white',
          }}
        >
          <IconButton
            type="button"
            variant="solid"
            size="1"
            aria-label={`Previous ${label} photo`}
            onClick={() => setIndex((index + available.length - 1) % available.length)}
          >
            <ChevronLeft size={16} />
          </IconButton>
          <Text size="1" aria-live="polite">
            {(index % available.length) + 1} / {available.length}
          </Text>
          <IconButton
            type="button"
            variant="solid"
            size="1"
            aria-label={`Next ${label} photo`}
            onClick={() => setIndex((index + 1) % available.length)}
          >
            <ChevronRight size={16} />
          </IconButton>
        </Flex>
      )}
    </Box>
  );
}

function price(hotel: StudioHotelQuote) {
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: hotel.currency }).format(
      hotel.price,
    );
  } catch {
    return `${hotel.currency} ${hotel.price.toFixed(2)}`;
  }
}

function HotelCard({
  hotel,
  reason,
  disabled,
  onSelect,
}: {
  hotel: StudioHotelQuote;
  reason?: string;
  disabled: boolean;
  onSelect: (quoteId: string) => void | Promise<void>;
}) {
  return (
    <Card size="2" data-testid="studio-hotel-card">
      <Grid columns={{ initial: '1', sm: '180px 1fr' }} gap="3">
        <PhotoCarousel photos={hotel.photos} label={hotel.name} />
        <Box style={{ minWidth: 0 }}>
          <Flex gap="2" wrap="wrap" align="center" mb="1">
            <Heading as="h4" size="3">
              {hotel.name}
            </Heading>
            {hotel.stars !== null && <Badge color="amber">{hotel.stars} star</Badge>}
            {hotel.group && <Badge color="gray">{hotel.group}</Badge>}
          </Flex>
          <Text as="p" size="2" color="gray">
            {hotel.address || 'Address unavailable'}
          </Text>
          {hotel.distanceKm !== null && (
            <Flex align="center" gap="1" mt="1">
              <MapPin size={13} />
              <Text size="1" color="gray">
                {hotel.distanceKm} km from destination centre · straight-line distance
              </Text>
            </Flex>
          )}
          <Text as="p" size="2" mt="2">
            {hotel.room}
            {hotel.board ? ` · ${hotel.board}` : ''}
          </Text>
          <Flex gap="1" wrap="wrap" my="2">
            {hotel.amenities.slice(0, 5).map((amenity) => (
              <Badge key={amenity} variant="soft" color="gray">
                {amenity}
              </Badge>
            ))}
          </Flex>
          {reason && (
            <Text as="p" size="2" mb="2" color="iris">
              {reason}
            </Text>
          )}
          <Flex justify="between" align="end" gap="3" wrap="wrap">
            <Box>
              <Text as="p" weight="bold" size="4">
                {price(hotel)}
              </Text>
              <Text as="p" size="1" color="gray">
                Full stay · {hotel.adults} adults
                {hotel.childAges.length
                  ? `, ${hotel.childAges.length} ${hotel.childAges.length === 1 ? 'child' : 'children'}`
                  : ''}{' '}
                · one room
              </Text>
              <Text as="p" size="1" color="gray">
                {readableDate(hotel.checkin)} – {readableDate(hotel.checkout)}
              </Text>
            </Box>
            <Button type="button" disabled={disabled} onClick={() => void onSelect(hotel.quoteId)}>
              Add to itinerary
            </Button>
          </Flex>
          <Flex gap="2" mt="2" wrap="wrap">
            <Badge color={hotel.mode === 'live' ? 'green' : 'amber'}>
              {hotel.mode === 'test'
                ? 'Sandbox availability'
                : hotel.mode === 'live'
                  ? 'Available at search time'
                  : 'Provider mode unverified'}
            </Badge>
            <Text size="1" color="gray">
              Reconfirmation required
            </Text>
          </Flex>
        </Box>
      </Grid>
      <Reset>
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>
            Hotel and room details
          </summary>
          <Box mt="3">
            <Text as="p" size="2" mb="2">
              {hotel.description || 'A hotel description was not supplied.'}
            </Text>
            <Text as="p" size="2" mb="2">
              {hotel.cancellation}
            </Text>
            <Text as="p" size="2" mb="2">
              {hotel.taxes}
            </Text>
            <Text as="p" size="1" color="gray" mb="3">
              Quote checked {new Date(hotel.quotedAt).toLocaleString()}. Adding a quote does not
              reserve a room.
            </Text>
            <Flex wrap="wrap" gap="1" mb="3">
              {hotel.amenities.map((amenity) => (
                <Badge key={amenity} color="gray">
                  {amenity}
                </Badge>
              ))}
            </Flex>
            <Heading as="h5" size="2" mb="2">
              Quoted room: {hotel.room}
            </Heading>
            <Text as="p" size="2" mb="2">
              {hotel.roomDescription || 'Room description unavailable for this quote.'}
            </Text>
            <Flex wrap="wrap" gap="1" mb="2">
              {hotel.roomAmenities.map((amenity) => (
                <Badge key={amenity} color="gray">
                  {amenity}
                </Badge>
              ))}
            </Flex>
            {hotel.roomPhotos.length > 0 ? (
              <Box style={{ maxWidth: 420 }}>
                <PhotoCarousel photos={hotel.roomPhotos} label={`${hotel.name} quoted room`} />
              </Box>
            ) : (
              <Text as="p" size="2" color="gray">
                The provider did not return photos mapped to this quoted room.
              </Text>
            )}
            {hotel.detailsStatus === 'unavailable' && (
              <Text as="p" size="1" color="gray" mt="2">
                Some property details could not be loaded. Missing amenities or photos do not mean
                the hotel lacks them.
              </Text>
            )}
          </Box>
        </details>
      </Reset>
    </Card>
  );
}

export default function StudioHotelResults({
  result,
  disabled = false,
  onSelect,
  onLoadMore,
  loadingMore = false,
}: {
  result: StudioHotelSearchResult;
  disabled?: boolean;
  onSelect: (quoteId: string) => void | Promise<void>;
  onLoadMore?: () => void | Promise<void>;
  loadingMore?: boolean;
}) {
  const [group, setGroup] = useState(''),
    [amenities, setAmenities] = useState<string[]>([]),
    [search, setSearch] = useState('');
  useEffect(() => {
    setGroup('');
    setAmenities([]);
    setSearch('');
  }, [result.quotes[0]?.id]);
  const groups = useMemo(
    () => [...new Set(result.hotels.map((hotel) => hotel.group).filter(Boolean))].sort(),
    [result],
  );
  const amenityOptions = useMemo(
    () => [...new Set(result.hotels.flatMap((hotel) => hotel.amenities))].sort(),
    [result],
  );
  const filtered = filterHotelQuotes(result.hotels, { group, amenities, search });
  const picks = result.recommendations.picks.flatMap((pick) => {
    const hotel = result.hotels.find((hotel) => hotel.quoteId === pick.quoteId);
    return hotel ? [{ hotel, reason: pick.reason }] : [];
  });
  return (
    <Box mt="4" data-testid="studio-hotel-results">
      <Heading as="h3" size="4" mb="2">
        {result.recommendations.status === 'ai'
          ? `AI recommended hotels (${picks.length})`
          : 'Hotel recommendations'}
      </Heading>
      <Text as="p" size="2" color="gray" mb="3">
        {result.recommendations.message}
      </Text>
      {picks.length > 0 && (
        <Flex direction="column" gap="3" mb="5" data-testid="hotel-recommendations">
          {picks.map(({ hotel, reason }) => (
            <HotelCard
              key={hotel.quoteId}
              hotel={hotel}
              reason={reason}
              disabled={disabled}
              onSelect={onSelect}
            />
          ))}
        </Flex>
      )}
      <Heading as="h3" size="4" mb="2">
        All returned hotels
      </Heading>
      <Text as="p" size="2" color="gray" mb="3">
        {result.inventory.returnedHotels} hotels · {result.inventory.returnedQuotes} room quotes.
        Search covers up to {result.inventory.limit} candidate hotels within{' '}
        {result.inventory.searchRadiusKm} km of the destination centre.
        {result.inventory.hasMore ? ' More inventory may exist outside this search.' : ''}
        {result.inventory.incomplete ? ' Some supplier pages were unavailable.' : ''}
      </Text>
      {onLoadMore &&
        result.inventory.nextOffset !== null &&
        result.inventory.nextOffset !== undefined && (
          <Button
            type="button"
            variant="soft"
            mb="3"
            disabled={disabled || loadingMore}
            loading={loadingMore}
            onClick={() => void onLoadMore()}
          >
            Load more available hotels
          </Button>
        )}
      {result.inventory.searchLimitReached && (
        <Text as="p" size="2" color="gray" mb="3">
          The search limit has been reached. More provider inventory may exist; refine the
          destination or review a supplier quote manually.
        </Text>
      )}
      <Grid columns={{ initial: '1', sm: '2' }} gap="3" mb="3">
        <label>
          <Text as="div" size="2" weight="medium" mb="1">
            Hotel group
          </Text>
          <Select.Root
            value={group || '__all'}
            onValueChange={(value) => setGroup(value === '__all' ? '' : value)}
          >
            <Select.Trigger aria-label="Hotel group" style={{ width: '100%' }} />
            <Select.Content>
              <Select.Item value="__all">All hotel groups</Select.Item>
              {groups.map((entry) => (
                <Select.Item key={entry} value={entry}>
                  {entry}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </label>
        <label>
          <Text as="div" size="2" weight="medium" mb="1">
            Hotel name or location
          </Text>
          <TextField.Root
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter returned results"
          />
        </label>
      </Grid>
      <Reset>
        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: 14 }}>
            Amenities{amenities.length ? ` (${amenities.length} selected)` : ''}
          </summary>
          <Flex gap="3" wrap="wrap" mt="2">
            {amenityOptions.map((amenity) => (
              <Text key={amenity} as="label" size="2">
                <Flex gap="1" align="center">
                  <Checkbox
                    checked={amenities.includes(amenity)}
                    onCheckedChange={(checked) =>
                      setAmenities((old) =>
                        checked ? [...old, amenity] : old.filter((entry) => entry !== amenity),
                      )
                    }
                  />
                  {amenity}
                </Flex>
              </Text>
            ))}
          </Flex>
          {!amenityOptions.length && (
            <Text as="p" size="2" color="gray" mt="2">
              The provider did not supply amenities for these results.
            </Text>
          )}
        </details>
      </Reset>
      <Flex gap="2" justify="between" align="center" mb="3">
        <Text size="2" color="gray">
          {filtered.length} matching room quotes · filters use supplied hotel details
        </Text>
        {(group || amenities.length > 0 || search) && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setGroup('');
              setAmenities([]);
              setSearch('');
            }}
          >
            Clear filters
          </Button>
        )}
      </Flex>
      <Flex direction="column" gap="3" data-testid="all-hotel-results">
        {filtered.map((hotel) => (
          <HotelCard key={hotel.quoteId} hotel={hotel} disabled={disabled} onSelect={onSelect} />
        ))}
      </Flex>
      {!filtered.length && (
        <Text as="p" size="2" color="gray">
          {result.hotels.length
            ? 'No returned hotels match these filters. Try clearing a filter.'
            : 'No available hotels were returned for this stay and party.'}
        </Text>
      )}
    </Box>
  );
}
