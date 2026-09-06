/**
 * A failed enquiry says why, instead of offering advice that cannot work.
 *
 * REPORTED FROM THE LIVE SITE: "send enquiry form is not getting submitted".
 *
 * The form caught the error, threw it away, and displayed "Could not send
 * enquiry. Please try again." Trying again could never have helped: the
 * failure is deterministic. And the message discarded the only thing that
 * named the layer.
 *
 * THE UNDERLYING BUG THE MESSAGE WAS HIDING
 *
 * supabase/migrations/009_car_enquiries.sql declares
 *
 *     car_id int NOT NULL
 *
 * while `Car.id` in cars-data.service.ts is a `string`, and both mapListing
 * and mapCatalogueCar populate it with a UUID — the same UUIDs visible in the
 * /cars response, e.g. "66289b53-c850-4236-8cdd-49b54245e131". Postgres
 * refuses that with 22P02, invalid_text_representation, on every submission.
 *
 * That mismatch is a schema change and is handled separately. This file covers
 * the part that made it invisible: the reporting.
 *
 * WHY THIS IS WORTH A TEST AT ALL
 *
 * This is the third time on this project that a swallowed error has cost real
 * time — the catalogue outage took a day and six wrong fixes for want of the
 * actual message. The rule these tests encode is narrow and cheap: when the
 * database refuses, the screen says what it said.
 */
import { describeEnquiryFailure } from './car-detail.component';

describe('describeEnquiryFailure', () => {
  it('names a schema mismatch as our fault, not the buyer\'s', () => {
    // 22P02 is what a UUID sent to an int column produces — the live bug.
    const text = describeEnquiryFailure({
      code: '22P02',
      message: 'invalid input syntax for type integer: "66289b53-c850-4236-8cdd-49b54245e131"',
    });

    expect(text).toContain('22P02');
    expect(text)
      .withContext('a buyer must be told their details did not arrive')
      .toContain('not sent');
    expect(text)
      .withContext('"try again" is advice that cannot work on a deterministic failure')
      .not.toContain('try again');
  });

  it('treats a missing column or table the same way', () => {
    // The schema-in-two-places trap: the code ships, the table does not.
    for (const code of ['42703', '42P01']) {
      expect(describeEnquiryFailure({ code, message: 'does not exist' }))
        .withContext(`postgres ${code}`)
        .toContain(code);
    }
  });

  it('says plainly when a security policy refused the row', () => {
    const text = describeEnquiryFailure({ code: '42501', message: 'new row violates RLS' });
    expect(text).toContain('42501');
    expect(text).toContain('not permitted');
  });

  it('keeps the database\'s own words for anything unrecognised', () => {
    // The important half. A code nobody anticipated must still reach the
    // screen intact — the whole failure of the old message was that it
    // replaced information with reassurance.
    const text = describeEnquiryFailure({ code: '23505', message: 'duplicate key value' });
    expect(text).toContain('duplicate key value');
  });

  it('survives an error object that is not shaped like a Postgres error', () => {
    // A thrown TypeError, a network failure, or null — none of which have a
    // .code — must not make the handler itself throw and leave a blank panel.
    expect(describeEnquiryFailure(new Error('Failed to fetch'))).toContain('Failed to fetch');
    expect(describeEnquiryFailure(null)).toBeTruthy();
    expect(describeEnquiryFailure(undefined)).toBeTruthy();
    expect(describeEnquiryFailure({})).toBeTruthy();
  });
});
