/**
 * Choosing the photographs to upload.
 *
 * Fifteen pictures of one car rarely arrive in a single gesture: some are
 * dragged in, some picked from a folder, some remembered afterwards. Selecting
 * replaced the list rather than adding to it, so each new gesture silently
 * discarded everything gathered before it — the form offered multiple
 * selection and then refused to keep it.
 *
 * HEIC was refused outright. The picker invites it, but Chrome reports an
 * empty MIME type for a .heic, and the filter tested only the MIME type — so
 * the file the picker had just offered was dropped as "not an image".
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AdminCarImagesComponent } from './admin-car-images.component';

function file(name: string, type = 'image/jpeg', size = 1024): File {
  const f = new File([new Uint8Array(size)], name, { type });
  return f;
}

function pick(c: AdminCarImagesComponent, files: File[]): void {
  const input = { files, value: 'x' } as unknown as HTMLInputElement;
  c.onFileSelect({ target: input } as unknown as Event);
}

describe('AdminCarImagesComponent — choosing photographs', () => {
  let c: AdminCarImagesComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminCarImagesComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    c = TestBed.createComponent(AdminCarImagesComponent).componentInstance;
  });

  it('keeps every image chosen in one go', () => {
    pick(c, [file('a.jpg'), file('b.jpg'), file('c.jpg')]);

    expect(c.selectedFiles().length).toBe(3);
  });

  it('adds to the selection instead of replacing it', () => {
    pick(c, [file('a.jpg'), file('b.jpg')]);
    pick(c, [file('c.jpg')]);

    expect(c.selectedFiles().map(f => f.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('does not add the same file twice', () => {
    pick(c, [file('a.jpg', 'image/jpeg', 500)]);
    pick(c, [file('a.jpg', 'image/jpeg', 500), file('b.jpg')]);

    expect(c.selectedFiles().map(f => f.name)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('treats same-named files of different sizes as different photographs', () => {
    pick(c, [file('IMG_1000.jpg', 'image/jpeg', 500)]);
    pick(c, [file('IMG_1000.jpg', 'image/jpeg', 900)]);

    expect(c.selectedFiles().length).toBe(2);
  });

  it('accepts a HEIC the browser could not identify', () => {
    pick(c, [file('front.heic', ''), file('side.HEIF', ''), file('rear.tif', '')]);

    expect(c.selectedFiles().length).toBe(3);
  });

  it('still refuses a file that is not a photograph', () => {
    pick(c, [file('brochure.pdf', 'application/pdf'), file('notes.txt', '')]);

    expect(c.selectedFiles().length).toBe(0);
  });

  it('keeps the images out of a mixed selection', () => {
    pick(c, [file('a.jpg'), file('brochure.pdf', 'application/pdf')]);

    expect(c.selectedFiles().map(f => f.name)).toEqual(['a.jpg']);
  });

  it('lets one file be taken back out, and the whole list cleared', () => {
    pick(c, [file('a.jpg'), file('b.jpg'), file('c.jpg')]);

    c.removeFile(c.selectedFiles()[1]);
    expect(c.selectedFiles().map(f => f.name)).toEqual(['a.jpg', 'c.jpg']);

    c.clearFiles();
    expect(c.selectedFiles().length).toBe(0);
  });

  it('warns past the API\'s file count, and not before', () => {
    pick(c, Array.from({ length: c.maxFiles }, (_, i) => file(`p${i}.jpg`)));
    expect(c.tooManyFiles()).toBeFalse();

    pick(c, [file('one-too-many.jpg')]);
    expect(c.tooManyFiles()).toBeTrue();
  });
});
