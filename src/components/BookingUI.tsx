import type { ReactNode } from 'react';
import { FlaskConical, ArrowLeft, CircleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import '../pages/bookings.css';

export function bookingPrice(amount: number, currency: string) {
  if (!Number.isFinite(amount)) return 'Price unavailable';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function SandboxNotice() {
  return (
    <div className="booking-sandbox" role="note">
      <FlaskConical size={20} />
      <div>
        <strong>Sandbox booking</strong>
        <p>
          This is a provider test reservation. No real stay or flight is reserved, and no payment is
          collected.
        </p>
      </div>
    </div>
  );
}

export function BookingPage({
  title,
  description,
  children,
  back = '/bookings',
  backLabel = 'Your bookings',
}: {
  title: string;
  description: string;
  children: ReactNode;
  back?: string;
  backLabel?: string;
}) {
  return (
    <div className="page-container booking-page">
      <Link className="booking-back" to={back}>
        <ArrowLeft size={15} />
        {backLabel}
      </Link>
      <div className="page-intro booking-intro">
        <span className="eyebrow">THE DETAILS, ALL TOGETHER</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}

export function BookingError({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="booking-alert" role="alert">
      <CircleAlert size={19} />
      <div>
        <p>{message}</p>
        {children}
      </div>
    </div>
  );
}

export function BookingSteps({ current }: { current: number }) {
  return (
    <ol className="booking-steps" aria-label="Booking steps">
      {['Review your quote', 'Guest details', 'Booking status'].map((label, index) => (
        <li
          key={label}
          aria-current={index === current ? 'step' : undefined}
          className={index <= current ? 'active' : ''}
        >
          <span>{index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
