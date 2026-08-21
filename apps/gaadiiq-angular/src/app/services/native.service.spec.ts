/**
 * photoToFile — the bridge between what the camera plugins return (a base64
 * data URL) and what the uploader takes (a File).
 *
 * Worth testing on its own because every branch is a silent failure: a bad
 * decode, the wrong extension or a dropped MIME type all produce a File that
 * uploads happily and is wrong at rest. None of that raises.
 */
import { NativeService } from './native.service';

/** A 1x1 PNG — the smallest real image, so the byte count is checkable. */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('NativeService.photoToFile', () => {
  it('decodes a data URL into a File with the right type and bytes', () => {
    const file = NativeService.photoToFile(
      { dataUrl: `data:image/png;base64,${PNG_B64}`, format: 'png' },
      'car-front',
    );

    expect(file).toBeTruthy();
    expect(file!.type).toBe('image/png');
    expect(file!.name).toBe('car-front.png');
    // atob of the payload above is 70 bytes; a wrong decode changes this.
    expect(file!.size).toBe(atob(PNG_B64).length);
  });

  it('writes .jpg rather than .jpeg, because the storage key uses the name', () => {
    const file = NativeService.photoToFile(
      { dataUrl: 'data:image/jpeg;base64,//8=', format: 'jpeg' },
      'shot',
    );
    expect(file!.name).toBe('shot.jpg');
    expect(file!.type).toBe('image/jpeg');
  });

  it('takes the extension from the MIME type, not the format field', () => {
    // Android reports 'jpeg', some devices 'jpg'; the MIME type is the one
    // that actually describes the bytes.
    const file = NativeService.photoToFile(
      { dataUrl: 'data:image/webp;base64,//8=', format: 'jpeg' },
      'x',
    );
    expect(file!.name).toBe('x.webp');
    expect(file!.type).toBe('image/webp');
  });

  it('returns null for something that is not a data URL', () => {
    expect(NativeService.photoToFile({ dataUrl: 'https://example.com/a.jpg', format: 'jpg' })).toBeNull();
    expect(NativeService.photoToFile({ dataUrl: '', format: 'jpg' })).toBeNull();
  });

  it('returns null for a truncated payload rather than half an image', () => {
    // '!!!!' is not valid base64. Returning a corrupt File here would upload
    // successfully and only fail when a buyer tried to look at the listing.
    expect(
      NativeService.photoToFile({ dataUrl: 'data:image/png;base64,!!!!', format: 'png' }),
    ).toBeNull();
  });

  it('defaults the extension when the MIME type has no subtype', () => {
    const file = NativeService.photoToFile({ dataUrl: 'data:image/;base64,//8=', format: '' }, 'y');
    expect(file!.name).toBe('y.jpg');
  });
});
