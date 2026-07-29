import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PdfIngestionService } from './pdf-ingestion.service';
import { SupabaseService } from './supabase.service';
import { CarsDataService } from './cars-data.service';
import { environment } from '../../environments/environment';

/**
 * The API and this UI use different field names for a job. Every path that
 * puts a job into the list must translate between them.
 *
 * pollJob did not: it wrote the API's own shape straight in, so four seconds
 * after a correctly mapped job appeared it was replaced by one rendering with
 * no filename, "NaN MB", a blank vehicle count, and the API's raw status word.
 */
const API_JOB = {
  id: 'job-1',
  source_pdf_name: 'swift-brochure.pdf',
  file_size_bytes: 2_411_724,
  status: 'completed',
  page_count: 12,
  image_count: 9,
  vehicle_count: 4,
  created_at: '2026-07-29T22:40:00Z',
  completed_at: '2026-07-29T22:40:31Z',
  images: [],
  vehicles: [],
};

describe('PdfIngestionService — job shape translation', () => {
  let svc: PdfIngestionService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        PdfIngestionService,
        { provide: SupabaseService, useValue: { client: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } } } },
        // Stubbed: the real one fetches /listings on construction, which would
        // leave unexpected open requests in every test here.
        { provide: CarsDataService, useValue: { addApprovedVehicle: () => {} } },
      ],
    });
    svc = TestBed.inject(PdfIngestionService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('pollJob maps the API shape instead of storing it raw', async () => {
    const pending = svc.pollJob('job-1');
    http.expectOne(`${environment.apiUrl}/brochures/jobs/job-1`).flush(API_JOB);
    const job = await pending;

    expect(job.filename).toBe('swift-brochure.pdf');
    expect(job.vehicles_found).toBe(4);
    // 'completed' is the API's word; the UI's own state machine uses this one.
    expect(job.status).toBe('AWAITING_REVIEW');
  });

  it('pollJob gives the list a job the template can render', async () => {
    // Seed the list first, so polling updates an existing entry the way it
    // does in the app.
    const seeding = svc.loadJobs();
    http.expectOne(`${environment.apiUrl}/brochures/jobs`).flush([API_JOB]);
    await seeding;

    const pending = svc.pollJob('job-1');
    http.expectOne(`${environment.apiUrl}/brochures/jobs/job-1`).flush(API_JOB);
    await pending;

    const job = svc.jobs().find(j => j.id === 'job-1')!;
    // Every field the jobs list binds to must be defined — undefined is what
    // produced "NaN MB" and a blank count.
    expect(job.filename).toBe('swift-brochure.pdf');
    expect(job.vehicles_found).toBe(4);
    expect(svc.formatSize(job.file_size)).not.toContain('NaN');
  });

  it('the file size survives the round trip', async () => {
    const pending = svc.pollJob('job-1');
    http.expectOne(`${environment.apiUrl}/brochures/jobs/job-1`).flush(API_JOB);
    const job = await pending;

    expect(job.file_size).toBe(2_411_724);
    expect(svc.formatSize(job.file_size)).toBe('2.3 MB');
  });

  it('a job with no size reported still renders a number', async () => {
    const pending = svc.pollJob('job-1');
    http.expectOne(`${environment.apiUrl}/brochures/jobs/job-1`)
      .flush({ ...API_JOB, file_size_bytes: undefined });
    const job = await pending;

    expect(svc.formatSize(job.file_size)).toBe('0 B');
  });

  it('loadJobs maps the list endpoint too', async () => {
    const pending = svc.loadJobs();
    http.expectOne(`${environment.apiUrl}/brochures/jobs`).flush([API_JOB]);
    await pending;

    expect(svc.jobs()[0].filename).toBe('swift-brochure.pdf');
    expect(svc.jobs()[0].status).toBe('AWAITING_REVIEW');
  });
});
