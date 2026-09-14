import { Injectable, signal, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

export interface MyListing {
  id: string;
  make: string; model: string; variant: string; year: number;
  km: number; fuel: string; transmission: string; owners: string;
  color: string; city: string; price: number; description: string;
  bodyType: string; name: string; phone: string; email: string;
  status: 'pending' | 'live' | 'sold';
  createdAt: string;
  // A uuid, not a number: cars.id is uuid. This was declared `number`
  // while holding a string at runtime, which is what led a later change
  // to call Number() on it and get NaN.
  supabaseId?: string | null;
  imageUrl?: string | null;

  /**
   * The `listings` row this advert is, as distinct from `supabaseId`, which
   * is the CAR row it is about.
   *
   * Taking an advert down means deactivating the listing, and until this was
   * stored there was nothing to address that with — see remove().
   *
   * Optional because every entry created before it existed has none; remove()
   * looks those up by car id instead.
   */
  listingId?: string | null;
}

// Single stable key — no email dependency, no key mismatch possible
const STORAGE_KEY = 'gaadiiq_my_listings';

@Injectable({ providedIn: 'root' })
export class MyListingsService {
  listings = signal<MyListing[]>([]);
  loading = signal(false);

  /**
   * One backend, on purpose.
   *
   * This service used to talk to the API for some operations and to Supabase
   * directly for others — reading `cars`, deleting `cars`, updating
   * `cars.price` — while the adverts a buyer sees live in `listings` behind
   * the API. Two clients, two tables, and localStorage as a third opinion.
   * Every seller-facing bug this session came out of that split: a removal
   * that hit the wrong table, a price edit nobody read, a sync that found a
   * seller's cars only because each submission minted a row stamped with
   * their email.
   *
   * It is all /listings now. HttpClient so auth.interceptor.ts signs each
   * request — every one of those endpoints checks the listing belongs to the
   * caller, and an unsigned one is a 401.
   */
  constructor(
    private auth: AuthService,
    private http: HttpClient,
  ) {
    // Load from localStorage immediately on service creation
    this.loadFromStorage();

    // When user logs in, also try to sync from Supabase.
    //
    // allowSignalWrites is load-bearing, not a lint appeasement. syncFromSupabase
    // opens with `this.loading.set(true)`, which runs synchronously inside this
    // effect — and Angular throws NG0600 ("writing to signals is not allowed")
    // for that by default. The throw happened before the query was ever issued,
    // so the sync did not merely warn: it never ran. A dealer's listings came
    // from localStorage alone, and the Inventory tab silently showed a stale or
    // empty inventory on any device that had not created them locally.
    //
    // Nothing surfaced it because the error goes to the console and the page
    // still renders — the listings just are not there, which is
    // indistinguishable from having none. Found by an e2e test watching the
    // console; e2e/dealer-dashboard.spec.ts now asserts NG0600 stays absent.
    effect(() => {
      const user = auth.currentUser();
      if (user?.email) this.syncFromSupabase(user.email);
    }, { allowSignalWrites: true });
  }

  private loadFromStorage(): void {
    try {
      // Merge from new key AND any old per-email keys
      const seen = new Set<string>();
      const all: MyListing[] = [];

      // New stable key
      const main: MyListing[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      for (const item of main) { seen.add(item.id); all.push(item); }

      // Legacy per-email keys (migrate them)
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('gaadiiq_listings_')) {
          try {
            const items: MyListing[] = JSON.parse(localStorage.getItem(k) || '[]');
            for (const item of items) {
              if (!seen.has(item.id)) { seen.add(item.id); all.push(item); }
            }
          } catch { /* ignore */ }
        }
      }

      all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (all.length > 0) {
        this.listings.set(all);
        // Migrate everything to the new stable key
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      }
    } catch { /* ignore */ }
  }

  private async syncFromSupabase(email: string): Promise<void> {
    this.loading.set(true);
    try {
      const timeout = new Promise<{ data: null; error: Error }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: new Error('timeout') }), 5000)
      );
      // GET /listings/me, not `cars` filtered by seller_email.
      //
      // WHY THIS MOVED
      //
      // A seller's adverts used to be found by querying `cars` for
      // seller_email — which only worked because this form minted a fresh
      // `cars` row per submission, stamped with the seller. That duplication
      // is the bug being removed: a used advert now JOINS the catalogue row
      // for its model, and that row belongs to the model, not to a seller. It
      // carries somebody else's email, or none.
      //
      // So ownership has to be read where it actually lives. `listings`
      // carries seller_id, and /listings/me is the endpoint that already
      // answers "which adverts are mine" — authenticated, so it cannot be
      // asked about anyone else's.
      //
      // It also carries the per-advert facts this list shows. The `cars`
      // columns it used to read — km, price, owners, city — are the ones the
      // duplicate rows existed to hold, and mapListing already stopped
      // trusting them for buyers.
      const query = firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/listings/me?page=1&page_size=100`),
      ).then(res => ({ data: res?.items ?? [], error: null }))
       .catch(err => ({ data: null, error: err }));

      const { data, error } = await Promise.race([query, timeout]) as any;

      if (!error && data && data.length > 0) {
        const remote: MyListing[] = data.map((r: any) => {
          const car = r.car ?? {};
          return {
            id: String(r.id),
            listingId: String(r.id),
            supabaseId: car.id ?? null,
            make: car.make ?? '', model: car.model ?? '', variant: car.variant ?? '',
            year: car.year ?? 0, km: r.km_driven ?? 0, fuel: car.fuel_type ?? '',
            transmission: car.transmission ?? '', owners: r.owners_count ? `${r.owners_count}` : '',
            color: '', city: r.city ?? '', price: Number(r.price) || 0,
            description: r.description ?? '', bodyType: car.body_type ?? '',
            name: this.auth.currentUser()?.name ?? '', phone: '',
            email,
            status: (r.is_active ? 'live' : 'sold') as MyListing['status'],
            createdAt: r.created_at ?? new Date().toISOString(),
            imageUrl: (r.image_urls ?? [])[0] ?? null,
          };
        });

        // Merge: the server's records win; keep entries it does not know about.
        //
        // Keyed on the LISTING, not the car. It used to dedupe on supabaseId —
        // the car id — which was unique per advert only because every
        // submission minted its own `cars` row. Now that a used advert joins
        // the model's row, two of a seller's adverts for the same model share
        // one car id, and keying on it would silently drop one of their cars
        // from their own list.
        //
        // supabaseId stays as the fallback for entries saved before listingId
        // existed, which have no listing id to key on.
        const local = this.listings();
        const remoteKeys = new Set(remote.map(r => r.listingId ?? `car:${r.supabaseId}`));
        const localOnly = local.filter(l => {
          const key = l.listingId ?? (l.supabaseId ? `car:${l.supabaseId}` : null);
          return !key || !remoteKeys.has(key);
        });
        const merged = [...remote, ...localOnly];
        merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        this.listings.set(merged);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      }
    } catch { /* keep local data */ }
    finally { this.loading.set(false); }
  }

  add(data: Omit<MyListing, 'id' | 'status' | 'createdAt'>): MyListing {
    const listing: MyListing = {
      ...data,
      id: Date.now().toString(),
      status: 'live',
      createdAt: new Date().toISOString(),
    };
    const updated = [listing, ...this.listings()];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    this.listings.set(updated);
    return listing;
  }

  /**
   * Change the asking price.
   *
   * PATCH /listings/{id}, because the price a buyer sees is on the LISTING.
   *
   * This used to write `cars.price` straight through Supabase, which was wrong
   * in two ways. The catalogue row is not the advert — /used-cars renders
   * listing.price, so the figure the seller changed was not the figure anyone
   * read. And now that a used advert joins the model's shared catalogue row,
   * writing to it would edit a row that belongs to every Swift on the site,
   * from one seller's price field.
   */
  async updatePrice(id: string, newPrice: number): Promise<void> {
    const listing = this.listings().find(l => l.id === id);
    if (!listing) return;

    const listingId = await this.listingIdFor(listing);
    if (listingId) {
      // Not caught: a refused edit must reach the caller, for the same reason
      // a refused removal must. Silence is what made the old one unfixable.
      await firstValueFrom(
        this.http.patch(`${environment.apiUrl}/listings/${listingId}`, { price: newPrice }),
      );
    }

    const updated = this.listings().map(l => l.id === id ? { ...l, price: newPrice } : l);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    this.listings.set(updated);
  }

  /**
   * Take an advert down.
   *
   * WHAT THIS USED TO DO, AND WHY IT STOPPED WORKING
   *
   * It deleted the CAR row:
   *
   *     this.sb.client.from('cars').delete().eq('id', listing.supabaseId)
   *       .then(() => {});
   *
   * That worked while a sold car was only a `cars` row. Once the sell form
   * began creating a real listing, it could not: `listings.car_id` is
   * ForeignKey("cars.id") with no ondelete, so Postgres defaults to NO ACTION
   * and refuses to delete a car an advert points at. And `.then(() => {})`
   * takes no error argument, so the refusal was discarded — the row vanished
   * from this page, the advert stayed live on /used-cars, and nothing said so.
   *
   * A seller who has sold their car could not take it off the market.
   *
   * WHAT IT DOES NOW
   *
   * Deactivates the LISTING, which is what DELETE /listings/{id} is for — a
   * soft delete setting is_active = false, so the advert leaves every
   * buyer-facing page while the row survives for the seller's own history.
   * The car row is left alone: it is the catalogue entry the photographs hang
   * off, and it is not what is being withdrawn.
   *
   * Falls back to the old behaviour only when there is no listing at all,
   * which is what an entry created before listings existed looks like.
   *
   * THROWS rather than reporting silently. The caller decides what to show,
   * and the one thing that must not happen again is a failure nobody sees.
   */
  async remove(id: string): Promise<void> {
    const listing = this.listings().find(l => l.id === id);
    if (!listing) return;

    const listingId = await this.listingIdFor(listing);
    if (listingId) {
      try {
        // Not swallowed: a REFUSED delete must reach the caller. Removing it
        // from this list regardless is exactly the bug this replaced.
        await firstValueFrom(
          this.http.delete(`${environment.apiUrl}/listings/${listingId}`),
        );
      } catch (err: any) {
        // ...but a 404 is not a refusal. It means the server has no such
        // advert, which is the state the seller is asking for.
        //
        // REPORTED: "Could not remove this listing (404): Listing not found.
        // It is still visible to buyers." — on an advert that had just been
        // deleted along with its catalogue row, so it was visible to nobody.
        // The entry could not be cleared, and the message said the opposite
        // of the truth.
        //
        // Anything a seller might act on — 403, a network failure, a 500 —
        // still throws, keeps the card on screen, and says so.
        if (err?.status !== 404) throw err;
      }
    }
    // No listing id means the server has no advert for this entry — a draft
    // this browser saved that never reached the API. There is nothing to
    // withdraw, so dropping the local row IS the removal.
    //
    // What used to happen here was a direct Supabase delete of the CAR row,
    // and that is the bug. A seller pressing Remove on their own advert has
    // no business deleting a catalogue row — it belongs to the model, not to
    // them, and since used adverts started sharing it, deleting it would take
    // every other seller's car with it. The database refuses (listings.car_id
    // is NOT NULL with no ON DELETE), so in practice the seller got an error
    // from a table they never meant to touch, for an advert that was already
    // gone from the server.

    const updated = this.listings().filter(l => l.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    this.listings.set(updated);
  }

  /**
   * The listing id for an advert that never stored one.
   *
   * Every entry created before `listingId` existed — including adverts placed
   * between the sell form learning to create listings and this being written —
   * knows only its car. /listings/me is the seller's own listings, so matching
   * on car id there is exact rather than a guess on make and model.
   *
   * Returns null on any failure, which sends remove() down the car-row path.
   * That path then fails loudly on the foreign key rather than pretending, so
   * a lookup outage cannot resurrect the silent success this replaced.
   */
  private async listingIdFor(listing: MyListing): Promise<string | null> {
    return listing.listingId ?? await this.findListingId(listing);
  }

  private async findListingId(listing: MyListing): Promise<string | null> {
    if (!listing.supabaseId) return null;
    try {
      const mine = await firstValueFrom(
        this.http.get<{ items: { id: string; car?: { id?: string } }[] }>(
          `${environment.apiUrl}/listings/me?page=1&page_size=100`,
        ),
      );
      const hit = (mine?.items ?? []).find(
        row => String(row.car?.id ?? '') === String(listing.supabaseId),
      );
      return hit?.id ?? null;
    } catch {
      return null;
    }
  }

  // Keep for backward compat
  async reload(): Promise<void> {
    this.loadFromStorage();
    const email = this.auth.currentUser()?.email;
    if (email) await this.syncFromSupabase(email);
  }
}
