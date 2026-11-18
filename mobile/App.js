import React, {useEffect, useRef, useState} from 'react';
import {Button, Linking, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';

const endpoint = process.env.EXPO_PUBLIC_API_URL
  || (Platform.OS === 'android' ? 'http://10.0.2.2:4100' : 'http://127.0.0.1:4100');
const roles = [['store', 'المحل'], ['driver', 'السائق أحمد'], ['driver2', 'السائق عمر'], ['admin', 'الإدارة']];
const labels = {
  searching: 'جاري البحث عن أقرب سائق', accepted: 'السائق في الطريق إلى المحل',
  arrived: 'وصل السائق إلى المحل', picked_up: 'الطلب في طريقه للتسليم',
  delivered: 'تم التسليم', cancelled: 'أُلغي الطلب',
};
const next = {
  accepted: ['arrived', 'وصلت إلى المحل'],
  arrived: ['picked_up', 'استلمت الطلب'],
  picked_up: ['delivered', 'تم التسليم'],
};
const dinars = fils => (fils / 1000).toFixed(3) + ' د.أ';
const requestId = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
const pointLink = ({lat, lng}) => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);

function Session({role}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const pending = useRef(false);
  const pendingOrder = useRef(null);
  const pendingTopup = useRef(null);
  const revision = useRef(0);

  async function request(input) {
    const response = await fetch(endpoint + '/api/state', {
      method: input ? 'POST' : 'GET',
      headers: {Authorization: 'Bearer demo-' + role, 'Content-Type': 'application/json'},
      body: input ? JSON.stringify(input) : undefined,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }

  useEffect(() => {
    let disposed = false;
    let loading = false;
    async function refresh() {
      if (pending.current || loading) return;
      loading = true;
      const version = revision.current;
      try {
        const result = await request();
        if (!disposed && version === revision.current) setData(result);
      } catch {
        if (!disposed && version === revision.current) setError('تعذر الاتصال بالخادم. تحقق من عنوان الخادم والشبكة.');
      } finally {
        loading = false;
      }
    }
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);

  async function send(input, done) {
    if (pending.current) return;
    pending.current = true;
    revision.current++;
    setBusy(true);
    setError('');
    try {
      setData(await request(input));
      done?.();
    } catch (failure) {
      setError(failure.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const button = (title, onPress, disabled = false) => <Button title={title} onPress={onPress} disabled={busy || disabled} color="#126653" />;
  const coordinateFields = <>
    <Field label="خط العرض" value={lat} change={setLat} />
    <Field label="خط الطول" value={lng} change={setLng} />
  </>;
  const point = {lat: lat.trim() ? Number(lat) : null, lng: lng.trim() ? Number(lng) : null};

  return <>
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    {!data ? <Text style={styles.text}>جارٍ الاتصال بالخادم</Text> : null}
    {data && role === 'store' && <View style={styles.card}>
      <Text style={styles.heading}>طلب سيارة</Text>
      <Field label="عنوان التسليم" value={address} change={setAddress} />
      {coordinateFields}
      {button('ابحث عن سائق', () => {
        const signature = JSON.stringify([address, point]);
        if (pendingOrder.current?.signature !== signature) pendingOrder.current = {signature, id: requestId()};
        send({action: 'create', requestId: pendingOrder.current.id, address, ...point}, () => {
          pendingOrder.current = null;
          setAddress('');
          setLat('');
          setLng('');
        });
      })}
    </View>}
    {data?.driver && <>
      <View style={styles.card}>
        <Text style={styles.heading}>محفظة العمولة</Text>
        <Text style={styles.text}>المتاح {dinars(data.wallet.available)} · المحجوز {dinars(data.wallet.reserved)}</Text>
        {data.topups.filter(top => top.status === 'pending').map(top => <View key={top.id}>
          {button('تأكيد شحن ' + dinars(top.amount), () => send({action: 'confirm', topupId: top.id}))}
        </View>)}
        {data.ledger.slice(0, 10).map((entry) => <Text key={entry.order || entry.topup} style={styles.text}>
          {entry.order ? 'عمولة رحلة' : 'شحن المحفظة'} · {dinars(entry.amount)}
        </Text>)}
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>{data.driver.available ? 'متاح' : 'غير متاح'}</Text>
        {coordinateFields}
        {button('تحديث الموقع والتوفّر', () => send({
          action: 'presence', available: true,
          lat: point.lat ?? data.driver.lat, lng: point.lng ?? data.driver.lng,
        }))}
        {button('إيقاف التوفّر', () => send({action: 'presence', available: false, lat: data.driver.lat, lng: data.driver.lng}))}
      </View>
      <Text style={styles.heading}>الطلبات القريبة</Text>
      {data.offers.length === 0 && <Text style={styles.text}>لا توجد طلبات متاحة الآن</Text>}
      {data.offers.map(offer => <View key={offer.id} style={styles.card}>
        <Text style={styles.text}>{data.store.name} · {offer.distance.toFixed(1)} كم</Text>
        {button('قبول الطلب', () => send({action: 'accept', orderId: offer.id}))}
      </View>)}
    </>}
    {data?.drivers && <View style={styles.card}>
      <Text style={styles.heading}>المتجر والسائقون</Text>
      {button('موقع المحل', () => pointLink(data.store))}
      <Field label="مبلغ الشحن بالفلس" value={amount} change={setAmount} />
      {data.drivers.map(driver => <View key={driver.id} style={styles.card}>
        <Text style={styles.text}>{driver.name} · {dinars(driver.balance - driver.reserved)}</Text>
        <Text style={styles.text}>{driver.eta ? `الوصول التقديري للمحل ${driver.eta} د` : 'الموقع بحاجة إلى تحديث'}</Text>
        {button('موقع السائق', () => pointLink(driver))}
        {button('إرسال طلب شحن إلى السائق', () => {
          const signature = `${driver.id}:${amount}`;
          if (pendingTopup.current?.signature !== signature) pendingTopup.current = {signature, id: requestId()};
          send({action: 'topup', driver: driver.id, amount: Number(amount), requestId: pendingTopup.current.id}, () => {
            pendingTopup.current = null;
            setAmount('');
          });
        })}
      </View>)}
      {data.topups.map(top => <Text key={top.id} style={styles.text}>
        {data.drivers.find(d => d.id === top.driver)?.name} · {dinars(top.amount)} · {top.status === 'pending' ? 'بانتظار التأكيد' : 'مؤكد'}
      </Text>)}
      <Field label="رقم الدعم" value={phone} change={setPhone} />
      {button('حفظ رقم الدعم', () => send({action: 'support', phone: phone.trim()}))}
    </View>}
    {data && <Text style={styles.heading}>{data.driver ? 'الرحلات' : 'الطلبات'}</Text>}
    {data?.orders.map(order => <View key={order.id} style={styles.card}>
      <Text style={styles.heading}>{labels[order.status]}</Text>
      <Text style={styles.text}>{order.address}</Text>
      {order.driverName && <Text style={styles.text}>{order.driverName}</Text>}
      {order.status === 'accepted' && order.eta && <Text style={styles.text}>الوصول التقديري للمحل خلال {order.eta} د</Text>}
      {button('موقع التسليم', () => pointLink(order))}
      {data.driver && next[order.status] && button(next[order.status][1], () =>
        send({action: 'advance', orderId: order.id, status: next[order.status][0]}))}
      {data.driver && ['accepted', 'arrived'].includes(order.status) &&
        button('اعتذار عن الطلب', () => send({action: 'release', orderId: order.id}))}
      {!data.driver && ['searching', 'accepted', 'arrived'].includes(order.status) &&
        button('إلغاء الطلب', () => send({action: 'cancel', orderId: order.id}))}
      {data.drivers && ['searching', 'accepted', 'arrived'].includes(order.status) &&
        button('إعادة الطلب إلى البحث', () => send({action: 'release', orderId: order.id}))}
      {data.drivers && order.status === 'searching' && data.drivers.filter(d => d.eligible).map(driver => <View key={driver.id}>
        {button('توجيه إلى ' + driver.name, () => send({action: 'assign', orderId: order.id, driver: driver.id}))}
      </View>)}
    </View>)}
    {data && role !== 'admin' && button(data.support ? 'اتصل بنا' : 'رقم الدعم غير متاح حاليًا',
      () => Linking.openURL('tel:' + data.support), !data.support)}
  </>;
}

function Field({label, value, change}) {
  return <View>
    <Text style={styles.text}>{label}</Text>
    <TextInput style={styles.field} accessibilityLabel={label} value={value} onChangeText={change} />
  </View>;
}

export default function App() {
  const [role, setRole] = useState('store');
  return <SafeAreaView style={styles.page}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>توصيل فوري</Text>
      <Text style={styles.text}>حسابات الاختبار</Text>
      <View style={styles.roles}>
        {roles.map(([id, label]) => <Button key={id} title={label} onPress={() => setRole(id)} disabled={role === id} color="#126653" />)}
      </View>
      <Session key={role} role={role} />
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#edf4f1', paddingTop: Platform.OS === 'android' ? 32 : 0},
  content: {padding: 20, gap: 12},
  title: {fontSize: 32, fontWeight: '800', color: '#12382f', textAlign: 'right'},
  heading: {fontSize: 19, fontWeight: '700', color: '#12382f', textAlign: 'right'},
  text: {fontSize: 15, color: '#324a43', textAlign: 'right'},
  error: {color: '#992e22', textAlign: 'right'},
  card: {backgroundColor: '#fff', borderRadius: 16, padding: 15, gap: 8},
  field: {borderColor: '#a1b9b0', borderWidth: 1, borderRadius: 10, padding: 10, textAlign: 'right'},
  roles: {flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6},
});
