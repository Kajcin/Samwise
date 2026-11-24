import { supabase } from '../core/supabase-client';
import { PlantPhotosService } from './plant-photos.service';

describe('PlantPhotosService', () => {
  let service: PlantPhotosService;
  let storage: { upload: jasmine.Spy; remove: jasmine.Spy; createSignedUrls: jasmine.Spy };

  beforeEach(() => {
    service = new PlantPhotosService();
    storage = {
      upload: jasmine.createSpy('upload').and.resolveTo({ data: {}, error: null }),
      remove: jasmine.createSpy('remove').and.resolveTo({ data: [], error: null }),
      createSignedUrls: jasmine.createSpy('createSignedUrls').and.resolveTo({
        data: [{ path: 'me/p1/a.jpg', signedUrl: 'https://storage.test/signed/a.jpg' }],
        error: null,
      }),
    };
    spyOn(supabase.storage, 'from').and.returnValue(storage as any);
    spyOn(supabase.auth, 'getUser').and.resolveTo({ data: { user: { id: 'me' } }, error: null } as any);
  });

  it('lists photos, showing uploads through signed URLs and links as they are', async () => {
    const rows = [
      { id: 'a', plant_id: 'p1', kind: 'upload', storage_path: 'me/p1/a.jpg', url: null, is_main: true },
      { id: 'b', plant_id: 'p1', kind: 'link', storage_path: null, url: 'https://x.cz/b.jpg', is_main: false },
    ];
    const builder: any = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.order = jasmine.createSpy('order').and.callFake(() => builder);
    builder.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
    spyOn(supabase, 'from').and.returnValue(builder);

    const photos = await service.list('p1');

    expect(photos.map((p) => p.displayUrl)).toEqual(['https://storage.test/signed/a.jpg', 'https://x.cz/b.jpg']);
    expect(storage.createSignedUrls).toHaveBeenCalledWith(['me/p1/a.jpg'], 3600);
    expect(builder.order.calls.allArgs()).toEqual([['is_main', { ascending: false }], ['created_at', { ascending: false }]]);
  });

  it('uploads a shrunk photo into your folder and adds it to the plant', async () => {
    const small = new Blob(['jpeg'], { type: 'image/jpeg' });
    spyOn(service as any, 'shrink').and.resolveTo(small);
    const insert = jasmine.createSpy('insert').and.resolveTo({ data: null, error: null });
    spyOn(supabase, 'from').and.returnValue({ insert } as any);

    await service.upload('p1', new Blob(['big']));

    const [path, body, options] = storage.upload.calls.mostRecent().args;
    expect(path).toMatch(/^me\/p1\/[0-9a-f-]+\.jpg$/);
    expect(body).toBe(small);
    expect(options).toEqual({ contentType: 'image/jpeg' });
    expect(insert).toHaveBeenCalledWith({ plant_id: 'p1', kind: 'upload', storage_path: path });
  });

  it('removes the uploaded file when the photo can’t be saved', async () => {
    spyOn(service as any, 'shrink').and.resolveTo(new Blob(['jpeg']));
    spyOn(supabase, 'from').and.returnValue({
      insert: () => Promise.resolve({ data: null, error: { message: 'denied' } }),
    } as any);

    await expectAsync(service.upload('p1', new Blob(['big']))).toBeRejected();
    expect(storage.remove).toHaveBeenCalledWith([storage.upload.calls.mostRecent().args[0]]);
  });

  it('adds a Wikimedia picture with its credit', async () => {
    const insert = jasmine.createSpy('insert').and.resolveTo({ data: null, error: null });
    spyOn(supabase, 'from').and.returnValue({ insert } as any);

    await service.addWikimedia('p1', {
      url: 'https://upload.wikimedia.org/a.jpg', author: 'Jane', license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg',
    });

    expect(insert).toHaveBeenCalledWith({
      plant_id: 'p1', kind: 'wikimedia', url: 'https://upload.wikimedia.org/a.jpg',
      attribution: {
        author: 'Jane', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg',
      },
    });
  });

  it('removing an upload deletes its file too; a link has none', async () => {
    const eq = jasmine.createSpy('eq').and.resolveTo({ data: null, error: null });
    spyOn(supabase, 'from').and.returnValue({ delete: () => ({ eq }) } as any);

    await service.remove({ id: 'a', storage_path: 'me/p1/a.jpg' });
    await service.remove({ id: 'b', storage_path: null });

    expect(eq.calls.allArgs()).toEqual([['id', 'a'], ['id', 'b']]);
    expect(storage.remove.calls.allArgs()).toEqual([[['me/p1/a.jpg']]]);
  });

  it('makes a photo the main one through the database function', async () => {
    spyOn(supabase, 'rpc').and.resolveTo({ data: null, error: null } as any);

    await service.setMain('b');
    expect(supabase.rpc).toHaveBeenCalledWith('set_main_plant_photo', { p_photo_id: 'b' });
  });
});
