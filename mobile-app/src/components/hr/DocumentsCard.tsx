import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from '../../lib/supabase';
import { useCalendarSystem } from '../../lib/CalendarSystemContext';
import { formatAdDate, localDateKey } from '../../lib/calendar';
import {
  DOCUMENTS_BUCKET,
  DOCUMENT_TYPES,
  documentContentType,
  documentStoragePath,
  formatBytes,
  validateDocumentFile,
  type DocumentType,
  type EmployeeDocument,
} from '../../lib/employeeDocuments';
import { colors } from '../../theme';
import { Button, CollapsibleCard, Field, LinkText, Notice, Sheet, confirmAsync, notify } from './HrKit';

type Picked = { uri: string; name: string; size: number | null };

/** An employee's documents: a checklist of the 17 kinds HR keeps, each with its uploaded
 * files. Files sit in a private bucket and are only ever opened through a short-lived
 * signed link made on the spot. With `selfService` it is the employee's own copy: what they
 * upload is tagged as theirs, and they can only delete what they added. */
export default function DocumentsCard({
  employeeId,
  companyId,
  defaultOpen,
  selfService,
}: {
  employeeId: string;
  companyId: string | null;
  defaultOpen?: boolean;
  selfService?: boolean;
}) {
  const { system } = useCalendarSystem();
  const [docs, setDocs] = useState<EmployeeDocument[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [uploadType, setUploadType] = useState<DocumentType | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [label, setLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('employee_documents').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false });
    if (error) {
      setLoadError(error.message);
      setStatus('unavailable');
      return;
    }
    setDocs((data ?? []) as EmployeeDocument[]);
    setStatus('ready');
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const byType = useMemo(() => {
    const map = new Map<DocumentType, EmployeeDocument[]>();
    for (const d of docs) map.set(d.doc_type, [...(map.get(d.doc_type) ?? []), d]);
    return map;
  }, [docs]);
  const typesOnFile = DOCUMENT_TYPES.filter(t => byType.has(t.value)).length;
  const typeLabel = DOCUMENT_TYPES.find(t => t.value === uploadType)?.label ?? '';
  const problems = picked.map(p => (p.size === null ? null : validateDocumentFile({ name: p.name, size: p.size }))).filter((m): m is string => m !== null);

  function openUpload(type: DocumentType) {
    setUploadType(type);
    setPicked([]);
    setLabel('');
    setUploadError('');
  }

  async function chooseFile() {
    setUploadError('');
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    setPicked(result.assets.map(a => ({ uri: a.uri, name: a.name, size: a.size ?? null })));
  }

  async function choosePhoto(fromCamera: boolean) {
    setUploadError('');
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      notify('Permission needed', fromCamera ? 'Camera access is required to photograph a document.' : 'Photo library access is required to pick a document photo.');
      return;
    }
    // quality 0.7 keeps a phone photo of a page comfortably under the 10 MB limit.
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 };
    const result = fromCamera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    setPicked([{ uri: a.uri, name: a.fileName || `photo-${Date.now()}.jpg`, size: a.fileSize ?? null }]);
  }

  async function handleUpload() {
    if (!uploadType || !companyId || picked.length === 0) return;
    setUploading(true);
    setUploadError('');
    let failure = '';
    for (const file of picked) {
      let buffer: ArrayBuffer;
      try {
        buffer = await (await fetch(file.uri)).arrayBuffer();
      } catch (e) {
        failure = `Could not read "${file.name}".`;
        break;
      }
      // The picker doesn't always know the size; the bytes just read are the truth.
      const problem = validateDocumentFile({ name: file.name, size: buffer.byteLength });
      if (problem) {
        failure = problem;
        break;
      }
      const path = documentStoragePath(companyId, employeeId, file.name);
      const contentType = documentContentType(file.name);
      const { error: storageError } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, buffer, { contentType, upsert: false });
      if (storageError) {
        failure = `Could not upload "${file.name}": ${storageError.message}`;
        break;
      }
      const { error: rowError } = await supabase.from('employee_documents').insert({
        employee_id: employeeId,
        doc_type: uploadType,
        // One label would be wrong for several different files, so it only applies to a single upload.
        title: picked.length === 1 ? label.trim() || null : null,
        file_path: path,
        file_name: file.name,
        mime_type: contentType,
        size_bytes: buffer.byteLength,
        ...(selfService ? { uploaded_by_employee: true } : {}),
      });
      if (rowError) {
        // Don't leave a file behind that nothing points to.
        await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
        failure = `Could not save "${file.name}": ${rowError.message}`;
        break;
      }
    }
    setUploading(false);
    await load();
    if (failure) return setUploadError(failure);
    setUploadType(null);
  }

  async function signedLink(doc: EmployeeDocument, seconds: number) {
    const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(doc.file_path, seconds);
    if (error || !data) {
      setActionError(`Could not open "${doc.file_name}": ${error?.message ?? 'no link was returned'}`);
      return null;
    }
    return data.signedUrl;
  }

  async function handleOpen(doc: EmployeeDocument) {
    setActionError('');
    // Five minutes, not one: a PDF viewer may ask for more of the file as you scroll.
    const url = await signedLink(doc, 300);
    if (url) Linking.openURL(url);
  }

  async function handleShare(doc: EmployeeDocument) {
    setActionError('');
    setBusyId(doc.id);
    const url = await signedLink(doc, 60);
    if (!url) return setBusyId(null);
    try {
      if (Platform.OS === 'web' || !(await Sharing.isAvailableAsync())) {
        Linking.openURL(url);
      } else {
        const target = `${FileSystem.cacheDirectory}${doc.file_name.replace(/[^\w.\-]+/g, '_')}`;
        const result = await FileSystem.downloadAsync(url, target);
        await Sharing.shareAsync(result.uri, { mimeType: doc.mime_type ?? undefined, dialogTitle: doc.file_name });
      }
    } catch (e) {
      setActionError(`Could not share "${doc.file_name}".`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(doc: EmployeeDocument) {
    const name = doc.title || doc.file_name;
    if (!(await confirmAsync('Delete document?', `Delete "${name}"? The file is permanently removed and can't be recovered.`, 'Delete', true))) return;
    setActionError('');
    setBusyId(doc.id);
    // File first: if this fails the record stays and the delete can be retried,
    // rather than leaving a private file that nothing points to.
    const { error: storageError } = await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.file_path]);
    if (storageError) {
      setBusyId(null);
      return setActionError(`Could not delete "${name}": ${storageError.message}`);
    }
    const { error: rowError } = await supabase.from('employee_documents').delete().eq('id', doc.id);
    setBusyId(null);
    if (rowError) setActionError(`The file was removed but its record could not be: ${rowError.message}`);
    load();
  }

  const summary = status === 'ready' ? `${typesOnFile} of ${DOCUMENT_TYPES.length} kinds on file` : status === 'unavailable' ? 'Not set up yet' : 'Loading…';

  return (
    <CollapsibleCard title="Documents" summary={summary} defaultOpen={defaultOpen}>
      <Text style={styles.intro}>
        {selfService
          ? 'PDF, image or Word file, up to 10 MB each. Stored privately — only you and HR can open them. You can add files and remove only the ones you added.'
          : 'PDF, image or Word file, up to 10 MB each. Stored privately — only the owner and HR can open them.'}
      </Text>

      {status === 'unavailable' && (
        <Notice tone="warning">
          {selfService
            ? `Your documents aren't available right now. (${loadError})`
            : `Documents can't be loaded yet. If this is the first time, run the latest database migration (20261101140000_employee_documents.sql) in Supabase. (${loadError})`}
        </Notice>
      )}
      {status !== 'unavailable' && !companyId && (
        <Notice tone="error">{selfService ? "Your account has no company recorded, so files can't be stored." : "This employee has no company recorded, so files can't be stored for them."}</Notice>
      )}
      {!!actionError && <Notice tone="error">{actionError}</Notice>}

      {status !== 'unavailable' &&
        DOCUMENT_TYPES.map(type => {
          const files = byType.get(type.value) ?? [];
          return (
            <View key={type.value} style={styles.type}>
              <View style={styles.typeRow}>
                <View style={[styles.dot, files.length > 0 && styles.dotOn]}>{files.length > 0 && <Text style={styles.tick}>✓</Text>}</View>
                <Text style={styles.typeName}>{type.label}</Text>
                <Text style={styles.typeCount}>{files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'Missing'}</Text>
                <LinkText label="+ Upload" onPress={() => openUpload(type.value)} disabled={status !== 'ready' || !companyId} />
              </View>
              {files.map(doc => (
                <View key={doc.id} style={styles.file}>
                  <Text style={styles.fileName} numberOfLines={2}>
                    {doc.title || doc.file_name}
                  </Text>
                  {!!doc.uploaded_by_employee && <Text style={styles.byEmployee}>{selfService ? 'Added by you' : 'Added by employee'}</Text>}
                  <Text style={styles.fileMeta}>
                    {[doc.title ? doc.file_name : null, formatBytes(doc.size_bytes) || null, formatAdDate(localDateKey(doc.created_at), system)].filter(Boolean).join(' · ')}
                  </Text>
                  <View style={styles.fileActions}>
                    <LinkText label="Open" onPress={() => handleOpen(doc)} />
                    <LinkText label="Share" onPress={() => handleShare(doc)} disabled={busyId === doc.id} />
                    {(!selfService || doc.uploaded_by_employee) && <LinkText label="Delete" tone="critical" onPress={() => handleDelete(doc)} disabled={busyId === doc.id} />}
                  </View>
                </View>
              ))}
            </View>
          );
        })}

      <Sheet
        visible={!!uploadType}
        title="Upload document"
        subtitle={typeLabel}
        onClose={() => setUploadType(null)}
        onSubmit={picked.length > 0 && problems.length === 0 ? handleUpload : undefined}
        saving={uploading}
        submitLabel={uploading ? 'Uploading…' : picked.length > 1 ? `Upload ${picked.length} files` : 'Upload'}
        error={uploadError}
      >
        <View style={styles.pickRow}>
          <Button label="Choose a file" tone="ghost" small onPress={chooseFile} disabled={uploading} />
          <Button label="Pick a photo" tone="ghost" small onPress={() => choosePhoto(false)} disabled={uploading} />
          {Platform.OS !== 'web' && <Button label="Take a photo" tone="ghost" small onPress={() => choosePhoto(true)} disabled={uploading} />}
        </View>
        {picked.map(p => {
          const problem = p.size === null ? null : validateDocumentFile({ name: p.name, size: p.size });
          return (
            <Text key={`${p.name}-${p.uri}`} style={[styles.picked, !!problem && { color: colors.criticalText }]}>
              {problem ?? `${p.name}${p.size !== null ? ` · ${formatBytes(p.size)}` : ''}`}
            </Text>
          );
        })}
        {picked.length === 1 && <Field label="Label (optional)" value={label} onChangeText={setLabel} placeholder="e.g. SEE certificate" />}
      </Sheet>
    </CollapsibleCard>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 12, color: colors.slate500, marginTop: 10, lineHeight: 17 },
  type: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { height: 18, width: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.slate400, alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: { color: colors.white, fontSize: 11, fontWeight: '900' },
  typeName: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.ink },
  typeCount: { fontSize: 11, color: colors.slate400 },
  file: { marginTop: 8, marginLeft: 26, backgroundColor: colors.slate50, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  fileName: { fontSize: 13, fontWeight: '700', color: colors.ink },
  fileMeta: { fontSize: 11, color: colors.slate500, marginTop: 2 },
  byEmployee: { fontSize: 10, fontWeight: '800', color: colors.goodText, marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.4 },
  fileActions: { flexDirection: 'row', gap: 16, marginTop: 6 },
  pickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  picked: { fontSize: 13, color: colors.ink, marginTop: 8 },
});
