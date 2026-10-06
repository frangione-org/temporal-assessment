# Juniper Salon — waitlist offer requirements

Captured from the customer conversation with Lena (owner, Juniper Salon). Each item is referenced by ID in the code review and slides.

## Today's problem

- Cancellations are noted in Square. Lena or Carla scan a Google Sheet for a match, text clients one by one from the salon phone, and wait.
- Staff lose track of who was contacted, who declined, and how long someone has been holding an offer. Some openings stay empty.
- 8–12 cancellations a week arrive within 48 hours of the appointment. Only about 3 in 10 get refilled today. A hard opening takes 20–30 minutes of back-and-forth.
- Texting everyone at once once caused two clients to expect the same Saturday haircut, and one left angry.
- **Goal:** refill at least half of last-minute cancellations without staff repeatedly checking on them.
- **Top priority:** reliably move to the next eligible person, without double-booking, when someone declines or times out.

## Requirements

### Waitlist (staff only)
- **W1** Each entry has name, mobile number, requested service, preferred stylist (or no preference), general availability, and the date they joined.
- **W2** Only staff add people, so details stay accurate. Carla or Lena can edit or remove entries.
- **W3** A decline or timeout applies only to that opening. The person stays on the list unless removed.
- **W4** Anyone who accepts an opening is removed from the list automatically.
- **W5** A client can stop future offers. They can still answer an offer they already have.

### Openings and matching
- **O1** Staff add an opening from the front-desk page with a simple form: service, stylist, date, time.
- **O2** A match has the same service and availability covering the opening time, and the stylist preference is respected if they have one.
- **O3** Among matches, whoever joined the waitlist earliest goes first.
- **O4** The opening is offered to one person at a time. It is never held by more than one person at once.
- **O5** Same-day openings get a 15-minute hold. Next-day openings get a longer hold that staff can adjust.
- **O6** On a decline, timeout or failed text, the offer moves to the next eligible person automatically.
- **O7** Offers stop when the appointment is too close to be useful or nobody eligible is left. The opening is then marked **unfilled**.
- **O8** No texts go out during quiet hours. Staff can adjust the quiet hours.
- **O9** A failed text is marked **failed**, the offer moves to the next person, and staff can see the failure.

### Client experience
- **C1** The offer text includes the service, stylist, date, time and reply-by time. It never includes the price.
- **C2** The client link shows only that client's own offer: no other clients and no waitlist position.
- **C3** A client accepts or declines from the link. An accept gets a simple confirmation with the appointment details.
- **C4** A "yes" after the hold ends gets this reply: the offer has expired and the opening is no longer available.

### Front desk (staff only)
- **F1** Staff pages are private, behind one shared staff sign-in. Signing in goes straight to today's openings, with no welcome page.
- **F2** Each opening shows the current holder and time left, earlier declines, timeouts and failures, remaining candidates in order, and the final result.
- **F3** When an opening is filled, a clear notice shows who accepted, with service, stylist, date and time, so staff know to update Square.
- **F4** Staff can skip the current person, cancel the offer (for example, the client changed their mind or the stylist became unavailable), or assign the opening by hand. These controls sit behind a details view and ask for confirmation. Manual assignment requires confirming the calendar was checked first.
- **F5** A simple settings area lets Lena or Carla change the next-day reply window and quiet hours without technical help.
- **F6** Mostly used on the front-desk computer, and must also work on a phone.
- **F7** The look is warm, calm and clean, under the Juniper Salon name. It should not feel like a technical dashboard.

### Out of scope (stated by Lena)
- Moving the accepted client's old appointment, or re-offering the slot it frees.
- Updating Square. Staff do this themselves.
- Clients joining the waitlist themselves. Staff add them for now.
- Tracking which staff member took an action.
- Price in messages.

## Prototype defaults (Lena asked for these to be adjustable)

| Setting | Default | Source |
|---|---|---|
| Same-day hold | 15 minutes | Lena |
| Next-day hold | 2 hours | Placeholder: Lena hasn't decided yet |
| Quiet hours | 9:00 PM – 8:00 AM | Placeholder: Lena hasn't decided yet |
| Stop offering | 30 minutes before the appointment | Placeholder: "too close to be useful" |

## Simulated in the prototype

- **Text messages:** messages are recorded and shown on screen, not sent. A number ending in `0000` simulates a failed delivery.
- **Square:** not connected. Staff are prompted to update it by hand, as they do today.
- **Google Sheet:** replaced by the staff waitlist page, with sample clients.
- **Staff sign-in:** a single shared passcode, not real accounts.
