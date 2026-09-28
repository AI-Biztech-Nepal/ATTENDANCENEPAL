import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal, FlatList } from 'react-native';
import { supabase } from '../lib/supabase';
import type { Employee } from '../types';
import { colors } from '../theme';
import EmployeeCalendarView from '../components/EmployeeCalendarView';

export default function CalendarScreen() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);

  useEffect(() => {
    supabase
      .from('employees')
      .select('*')
      .eq('status', 'active')
      .then(({ data }) => {
        const sorted = ((data as Employee[]) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        setEmployees(sorted);
        if (sorted.length > 0) setEmployeeId(sorted[0].id);
      });
  }, []);

  const employee = employees.find(e => e.id === employeeId) ?? null;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <TouchableOpacity style={styles.employeePicker} onPress={() => setEmployeePickerOpen(true)}>
          <Text style={styles.employeePickerLabel}>Employee</Text>
          <Text style={styles.employeePickerValue}>{employee?.name ?? 'Select…'}</Text>
        </TouchableOpacity>

        {employeeId && <EmployeeCalendarView employeeId={employeeId} />}
      </ScrollView>

      <Modal visible={employeePickerOpen} transparent animationType="fade" onRequestClose={() => setEmployeePickerOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setEmployeePickerOpen(false)}>
          <View style={styles.modalSheet}>
            <FlatList
              data={employees}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalOption}
                  onPress={() => {
                    setEmployeeId(item.id);
                    setEmployeePickerOpen(false);
                  }}
                >
                  <Text style={styles.modalOptionText}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  employeePicker: { backgroundColor: colors.white, borderRadius: 16, padding: 14, marginBottom: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  employeePickerLabel: { fontSize: 10, color: colors.slate400, textTransform: 'uppercase', fontWeight: '700' },
  employeePickerValue: { fontSize: 16, fontWeight: '700', color: colors.ink, marginTop: 3 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 20 },
  modalSheet: { backgroundColor: colors.white, borderRadius: 16, maxHeight: '60%' },
  modalOption: { paddingHorizontal: 20, paddingVertical: 14 },
  modalOptionText: { fontSize: 14, color: colors.ink },
});
