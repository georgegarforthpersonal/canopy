import { describe, it, expect } from 'vitest';
import {
  SURVEY_PHOTO_ACCEPT,
  orderSurveyPhotos,
  partitionSurveyPhotoFiles,
  rejectedPhotosMessage,
} from './surveyPhotos';

function fileNamed(name: string): File {
  return new File(['x'], name, { type: 'application/octet-stream' });
}

describe('SURVEY_PHOTO_ACCEPT', () => {
  it('lists the extensions the images endpoint takes', () => {
    expect(SURVEY_PHOTO_ACCEPT).toBe('.jpg,.jpeg,.png,.tiff,.tif,.bmp');
  });
});

describe('partitionSurveyPhotoFiles', () => {
  it('keeps image files and names the rest', () => {
    const { accepted, rejected } = partitionSurveyPhotoFiles([
      fileNamed('plate-1.JPG'),
      fileNamed('notes.pdf'),
      fileNamed('scan.tiff'),
      fileNamed('README'),
    ]);

    expect(accepted.map((f) => f.name)).toEqual(['plate-1.JPG', 'scan.tiff']);
    expect(rejected).toEqual(['notes.pdf', 'README']);
  });

  it('is case insensitive on the extension', () => {
    const { accepted } = partitionSurveyPhotoFiles([fileNamed('A.PNG'), fileNamed('b.JpEg')]);
    expect(accepted).toHaveLength(2);
  });

  it('handles an empty selection', () => {
    expect(partitionSurveyPhotoFiles([])).toEqual({ accepted: [], rejected: [] });
  });
});

describe('rejectedPhotosMessage', () => {
  it('is null when nothing was skipped', () => {
    expect(rejectedPhotosMessage([])).toBeNull();
  });

  it('uses the singular for one file', () => {
    expect(rejectedPhotosMessage(['notes.pdf'])).toBe(
      '1 file is not an accepted image type: notes.pdf'
    );
  });

  it('uses the plural for several', () => {
    expect(rejectedPhotosMessage(['a.pdf', 'b.doc'])).toBe(
      '2 files are not an accepted image type: a.pdf, b.doc'
    );
  });
});

describe('orderSurveyPhotos', () => {
  it('sorts digit runs numerically, not as text', () => {
    const ordered = orderSurveyPhotos([
      { id: 1, filename: 'page-10.jpg' },
      { id: 2, filename: 'page-9.jpg' },
      { id: 3, filename: 'page-2.jpg' },
    ]);
    expect(ordered.map((p) => p.filename)).toEqual(['page-2.jpg', 'page-9.jpg', 'page-10.jpg']);
  });

  it('breaks filename ties on id so the order is stable', () => {
    const ordered = orderSurveyPhotos([
      { id: 7, filename: 'plate.jpg' },
      { id: 3, filename: 'plate.jpg' },
    ]);
    expect(ordered.map((p) => p.id)).toEqual([3, 7]);
  });

  it('does not mutate its input', () => {
    const input = [
      { id: 1, filename: 'b.jpg' },
      { id: 2, filename: 'a.jpg' },
    ];
    orderSurveyPhotos(input);
    expect(input.map((p) => p.filename)).toEqual(['b.jpg', 'a.jpg']);
  });
});
