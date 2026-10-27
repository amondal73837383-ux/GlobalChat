import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:http/http.dart' as http;
import 'package:socket_io_client/socket_io_client.dart' as io;

import 'app_config.dart';

void main() => runApp(const GlobalChatApp());

const secureStorage = FlutterSecureStorage();
const brand = Color(0xFF6658F5);
const ink = Color(0xFF101629);

class RemoteBrand {
  static String appName = 'GlobalChat';
  static String logoUrl = '';
  static Color primaryColor = brand;
  static Future<void> load() async {
    try {
      final data = await Api.request('/api/config');
      final config = Map<String, dynamic>.from(data['config'] as Map);
      appName = config['appName']?.toString() ?? 'GlobalChat';
      final url = config['logoUrl']?.toString() ?? '';
      logoUrl = url.startsWith('https://') ? url : '';
      final color = config['primaryColor']?.toString() ?? '#6658F5';
      if (RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(color)) primaryColor = Color(0xFF000000 | int.parse(color.substring(1), radix: 16));
    } catch (_) {}
  }
}

class GlobalChatApp extends StatefulWidget {
  const GlobalChatApp({super.key});
  @override State<GlobalChatApp> createState() => _GlobalChatAppState();
}

class _GlobalChatAppState extends State<GlobalChatApp> {
  @override void initState() { super.initState(); RemoteBrand.load().then((_) { if (mounted) setState(() {}); }); }
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: RemoteBrand.appName,
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(seedColor: RemoteBrand.primaryColor, brightness: Brightness.light),
          scaffoldBackgroundColor: const Color(0xFFF6F7FC),
          appBarTheme: const AppBarTheme(backgroundColor: Color(0xFFF6F7FC), foregroundColor: ink, elevation: 0, centerTitle: false),
          inputDecorationTheme: InputDecorationTheme(
            filled: true,
            fillColor: Colors.white,
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(15), borderSide: const BorderSide(color: Color(0xFFE5E8F2))),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(15), borderSide: const BorderSide(color: Color(0xFFE5E8F2))),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(15), borderSide: BorderSide(color: RemoteBrand.primaryColor, width: 1.5)),
          ),
          filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(backgroundColor: RemoteBrand.primaryColor, foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(vertical: 15, horizontal: 18), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)), textStyle: const TextStyle(fontWeight: FontWeight.w700))),
        ),
        home: const SessionGate(),
      );
}

class Api {
  static String? token;
  static Map<String, dynamic> _decode(http.Response response) {
    Map<String, dynamic> data;
    try { data = jsonDecode(response.body) as Map<String, dynamic>; }
    catch (_) { throw Exception('The server returned an invalid response.'); }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(data['error']?.toString() ?? 'Request failed (${response.statusCode}).');
    }
    return data;
  }

  static Future<Map<String, dynamic>> request(String path, {String method = 'GET', Map<String, dynamic>? body, bool auth = false}) async {
    final base = AppConfig.apiBaseUrl.replaceAll(RegExp(r'/$'), '');
    if (!base.startsWith('https://')) throw Exception('Set the HTTPS API URL in lib/app_config.dart.');
    final headers = <String, String>{'Content-Type': 'application/json', 'Accept': 'application/json'};
    if (auth && token != null) headers['Authorization'] = 'Bearer $token';
    final uri = Uri.parse('$base$path');
    late http.Response response;
    try {
      switch (method) {
        case 'POST': response = await http.post(uri, headers: headers, body: jsonEncode(body ?? {})).timeout(const Duration(seconds: 20)); break;
        case 'PATCH': response = await http.patch(uri, headers: headers, body: jsonEncode(body ?? {})).timeout(const Duration(seconds: 20)); break;
        case 'PUT': response = await http.put(uri, headers: headers, body: jsonEncode(body ?? {})).timeout(const Duration(seconds: 20)); break;
        default: response = await http.get(uri, headers: headers).timeout(const Duration(seconds: 20));
      }
      return _decode(response);
    } on http.ClientException { throw Exception('Could not connect. Check your internet connection and backend URL.'); }
  }

  static Future<Uint8List> getBytes(String path) async {
    final base = AppConfig.apiBaseUrl.replaceAll(RegExp(r'/$'), '');
    final headers = <String, String>{};
    if (token != null) headers['Authorization'] = 'Bearer $token';
    try {
      final response = await http.get(Uri.parse('$base$path'), headers: headers).timeout(const Duration(seconds: 25));
      if (response.statusCode < 200 || response.statusCode >= 300) throw Exception('Could not load this voice message.');
      return response.bodyBytes;
    } on http.ClientException { throw Exception('Could not download the voice message.'); }
  }
}

class SessionGate extends StatefulWidget {
  const SessionGate({super.key});
  @override State<SessionGate> createState() => _SessionGateState();
}

class _SessionGateState extends State<SessionGate> {
  bool loading = true;
  Map<String, dynamic>? user;
  @override void initState() { super.initState(); _restore(); }
  Future<void> _restore() async {
    await RemoteBrand.load();
    try {
      Api.token = await secureStorage.read(key: 'token');
      final savedId = await secureStorage.read(key: 'userId');
      if (Api.token != null && savedId != null) {
        final data = await Api.request('/api/me', auth: true);
        user = Map<String, dynamic>.from(data['user'] as Map);
      }
    } catch (_) { await secureStorage.deleteAll(); Api.token = null; }
    if (mounted) setState(() => loading = false);
  }
  @override Widget build(BuildContext context) {
    if (loading) return const Scaffold(body: Center(child: CircularProgressIndicator(color: brand)));
    if (user != null) return ChatHome(user: user!);
    return AuthPage(onAuthenticated: (value) => setState(() => user = value));
  }
}

class AuthPage extends StatefulWidget {
  final ValueChanged<Map<String, dynamic>> onAuthenticated;
  const AuthPage({super.key, required this.onAuthenticated});
  @override State<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends State<AuthPage> {
  final name = TextEditingController();
  final phone = TextEditingController();
  final password = TextEditingController();
  bool register = true, busy = false, obscure = true;
  String error = '';

  Future<void> submit() async {
    FocusScope.of(context).unfocus();
    if (phone.text.trim().isEmpty || password.text.isEmpty || (register && name.text.trim().isEmpty)) {
      setState(() => error = 'Please fill in all required fields.'); return;
    }
    if (register && password.text.length < 10) { setState(() => error = 'Choose a password with at least 10 characters.'); return; }
    setState(() { busy = true; error = ''; });
    try {
      final data = await Api.request(register ? '/api/auth/register' : '/api/auth/login', method: 'POST', body: register
          ? {'displayName': name.text.trim(), 'phoneNumber': phone.text.trim(), 'password': password.text}
          : {'phoneNumber': phone.text.trim(), 'password': password.text});
      Api.token = data['token'] as String;
      final user = Map<String, dynamic>.from(data['user'] as Map);
      await secureStorage.write(key: 'token', value: Api.token);
      await secureStorage.write(key: 'userId', value: user['userId'].toString());
      if (mounted) widget.onAuthenticated(user);
    } catch (e) { if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', '')); }
    finally { if (mounted) setState(() => busy = false); }
  }

  @override void dispose() { name.dispose(); phone.dispose(); password.dispose(); super.dispose(); }
  @override Widget build(BuildContext context) => Scaffold(body: SafeArea(child: Center(child: SingleChildScrollView(padding: const EdgeInsets.all(24), child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 440), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    Container(width: 70, height: 70, alignment: Alignment.center, clipBehavior: Clip.antiAlias, decoration: BoxDecoration(gradient: const LinearGradient(colors: [Color(0xFF877BFF), brand]), borderRadius: BorderRadius.circular(24), boxShadow: [BoxShadow(color: brand.withValues(alpha: .22), blurRadius: 25, offset: const Offset(0, 10))]), child: RemoteBrand.logoUrl.isNotEmpty ? Image.network(RemoteBrand.logoUrl, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Icon(Icons.forum_rounded, color: Colors.white, size: 35)) : const Icon(Icons.forum_rounded, color: Colors.white, size: 35)),
    const SizedBox(height: 22), Text(register ? 'Meet your people.' : 'Welcome back.', style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800, letterSpacing: -1.2, color: ink)),
    const SizedBox(height: 8), Text(register ? 'Create your GlobalChat account and start a conversation.' : 'Sign in to pick up where you left off.', style: const TextStyle(color: Color(0xFF747C93), height: 1.5)),
    const SizedBox(height: 28), if (register) ...[const _FieldLabel('DISPLAY NAME'), TextField(controller: name, textCapitalization: TextCapitalization.words, textInputAction: TextInputAction.next, decoration: const InputDecoration(hintText: 'How should people know you?')), const SizedBox(height: 16)],
    const _FieldLabel('PHONE NUMBER'), TextField(controller: phone, keyboardType: TextInputType.phone, textInputAction: TextInputAction.next, decoration: const InputDecoration(prefixIcon: Icon(Icons.phone_iphone_rounded), hintText: '+91 98765 43210')), const SizedBox(height: 16),
    const _FieldLabel('PASSWORD'), TextField(controller: password, obscureText: obscure, onSubmitted: (_) => submit(), decoration: InputDecoration(prefixIcon: const Icon(Icons.lock_outline_rounded), hintText: register ? 'At least 10 characters' : 'Your password', suffixIcon: IconButton(onPressed: () => setState(() => obscure = !obscure), icon: Icon(obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined)))),
    const SizedBox(height: 10), const Text('Phone numbers are not verified yet. Use a number you control; OTP can be added later.', style: TextStyle(fontSize: 11, color: Color(0xFF858DA2), height: 1.4)),
    if (error.isNotEmpty) ...[const SizedBox(height: 12), _ErrorBanner(error)], const SizedBox(height: 18), FilledButton(onPressed: busy ? null : submit, child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [if (busy) const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) else Text(register ? 'Create account' : 'Sign in'), const SizedBox(width: 8), if (!busy) const Icon(Icons.arrow_forward_rounded, size: 18)])),
    const SizedBox(height: 10), TextButton(onPressed: busy ? null : () => setState(() { register = !register; error = ''; }), child: Text(register ? 'Already have an account? Sign in' : 'New to GlobalChat? Create an account')),
    const SizedBox(height: 20), const Center(child: Text('A simple messaging MVP • End-to-end encryption is not enabled', textAlign: TextAlign.center, style: TextStyle(fontSize: 10, color: Color(0xFF9AA1B3)))),
  ]))))));
}

class ChatHome extends StatefulWidget {
  final Map<String, dynamic> user;
  const ChatHome({super.key, required this.user});
  @override State<ChatHome> createState() => _ChatHomeState();
}

class _ChatHomeState extends State<ChatHome> {
  final search = TextEditingController();
  bool loading = true, busy = false;
  String error = '';
  List<dynamic> conversations = [];
  @override void initState() { super.initState(); load(); }
  Future<void> load() async {
    try { final data = await Api.request('/api/conversations', auth: true); if (mounted) setState(() { conversations = data['conversations'] as List<dynamic>; error = ''; }); }
    catch (e) { if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', '')); }
    finally { if (mounted) setState(() => loading = false); }
  }
  Future<void> startChat() async {
    final query = search.text.trim(); if (query.length < 3) { setState(() => error = 'Enter a phone number or GlobalChat ID.'); return; }
    setState(() { busy = true; error = ''; });
    try {
      final found = await Api.request('/api/users/search?q=${Uri.encodeQueryComponent(query)}', auth: true);
      final users = found['users'] as List<dynamic>;
      if (users.isEmpty) throw Exception('No account found for that phone number or ID.');
      final target = Map<String, dynamic>.from(users.first as Map);
      final data = await Api.request('/api/conversations/direct', method: 'POST', body: {'otherUserId': target['userId'].toString()}, auth: true);
      search.clear(); await load();
      if (!mounted) return;
      await Navigator.push(context, MaterialPageRoute(builder: (_) => ConversationPage(conversationId: (data['conversation'] as Map)['_id'].toString(), title: target['displayName']?.toString() ?? 'Conversation', currentUserId: widget.user['userId'].toString())));
      await load();
    } catch (e) { if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', '')); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> createGroup() async {
    final name = TextEditingController(); final members = TextEditingController();
    final ok = await showDialog<bool>(context: context, builder: (context) => AlertDialog(title: const Text('Create a group'), content: Column(mainAxisSize: MainAxisSize.min, children: [TextField(controller: name, decoration: const InputDecoration(labelText: 'Group name')), const SizedBox(height: 12), TextField(controller: members, maxLines: 3, decoration: const InputDecoration(labelText: 'Member phone numbers or IDs', hintText: 'Separate members with commas'))]), actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Create'))]));
    if (ok != true) { name.dispose(); members.dispose(); return; }
    setState(() { busy = true; error = ''; });
    try {
      final inputs = members.text.split(',').map((e) => e.trim()).where((e) => e.isNotEmpty).toSet();
      final ids = <String>[];
      for (final input in inputs) {
        final result = await Api.request('/api/users/search?q=${Uri.encodeQueryComponent(input)}', auth: true);
        final users = result['users'] as List<dynamic>;
        if (users.isEmpty) throw Exception('No user found for: $input');
        ids.add((users.first as Map)['userId'].toString());
      }
      await Api.request('/api/conversations/group', method: 'POST', body: {'name': name.text.trim(), 'memberIds': ids}, auth: true);
      await load();
    } catch (e) { if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', '')); }
    finally { name.dispose(); members.dispose(); if (mounted) setState(() => busy = false); }
  }
  Future<void> logout() async { await secureStorage.deleteAll(); Api.token = null; if (mounted) Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => const _SignedOut()), (_) => false); }
  @override void dispose() { search.dispose(); super.dispose(); }
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Row(children: [const Icon(Icons.forum_rounded, color: brand), const SizedBox(width: 9), Text(RemoteBrand.appName, style: const TextStyle(fontWeight: FontWeight.w800, letterSpacing: -.5))]), actions: [IconButton(tooltip: 'Profile', onPressed: () => showDialog(context: context, builder: (_) => AlertDialog(title: Text(widget.user['displayName']?.toString() ?? 'Your profile'), content: SelectableText('GlobalChat ID: ${widget.user['userId']}\nPhone: ${widget.user['phoneNumber'] ?? 'Not available'}\n\nShare your ID with friends so they can find you.'), actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Done'))])), IconButton(tooltip: 'Log out', onPressed: logout, icon: const Icon(Icons.logout_rounded))]), body: RefreshIndicator(onRefresh: load, child: ListView(padding: const EdgeInsets.fromLTRB(18, 8, 18, 24), children: [
    Container(padding: const EdgeInsets.all(20), decoration: BoxDecoration(gradient: const LinearGradient(colors: [Color(0xFF29265D), Color(0xFF6658F5)]), borderRadius: BorderRadius.circular(23)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('YOUR SPACE, YOUR PEOPLE', style: TextStyle(color: Color(0xFFDAD7FF), fontSize: 10, fontWeight: FontWeight.w800, letterSpacing: 1.5)), const SizedBox(height: 10), Text('Hey, ${widget.user['displayName'] ?? 'there'} 👋', style: const TextStyle(color: Colors.white, fontSize: 25, fontWeight: FontWeight.w800, letterSpacing: -.8)), const SizedBox(height: 6), const Text('A good conversation can start with one message.', style: TextStyle(color: Color(0xFFE1DFFF), fontSize: 12)), const SizedBox(height: 18), Container(padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8), decoration: BoxDecoration(color: Colors.white.withValues(alpha: .12), borderRadius: BorderRadius.circular(12)), child: Row(children: [const Icon(Icons.badge_outlined, color: Colors.white, size: 18), const SizedBox(width: 9), Expanded(child: Text('Your GlobalChat ID: ${widget.user['userId']}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700))), IconButton(visualDensity: VisualDensity.compact, onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Share your GlobalChat ID with friends.'))), icon: const Icon(Icons.share_outlined, color: Colors.white, size: 18))]))]),
    const SizedBox(height: 22), const Text('Start something new', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: ink)), const SizedBox(height: 5), const Text('Find someone by phone number or GlobalChat ID.', style: TextStyle(color: Color(0xFF858DA2), fontSize: 12)), const SizedBox(height: 12), Row(children: [Expanded(child: TextField(controller: search, keyboardType: TextInputType.text, onSubmitted: (_) => startChat(), decoration: const InputDecoration(prefixIcon: Icon(Icons.search_rounded), hintText: '+91 phone number or ID'))), const SizedBox(width: 8), SizedBox(height: 52, child: FilledButton(onPressed: busy ? null : startChat, child: const Icon(Icons.arrow_forward_rounded))) ]), const SizedBox(height: 10), OutlinedButton.icon(onPressed: busy ? null : createGroup, icon: const Icon(Icons.group_add_rounded), label: const Text('Create a group chat'), style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)))),
    if (error.isNotEmpty) ...[const SizedBox(height: 10), _ErrorBanner(error)], const SizedBox(height: 25), Row(children: [const Expanded(child: Text('Your conversations', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: ink))), Text('${conversations.length}', style: const TextStyle(color: Color(0xFF8991A6), fontWeight: FontWeight.w700))]), const SizedBox(height: 10),
    if (loading) const Padding(padding: EdgeInsets.all(30), child: Center(child: CircularProgressIndicator(color: brand)))
    else if (conversations.isEmpty) Container(padding: const EdgeInsets.all(24), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0xFFE8EAF3))), child: const Column(children: [Icon(Icons.forum_outlined, size: 38, color: Color(0xFFAAAED0)), SizedBox(height: 10), Text('It’s quiet here for now', style: TextStyle(fontWeight: FontWeight.w800, color: ink)), SizedBox(height: 5), Text('Start a chat above and your conversations will appear here.', textAlign: TextAlign.center, style: TextStyle(color: Color(0xFF858DA2), fontSize: 12, height: 1.5))]))
    else for (final raw in conversations) _ConversationTile(conversation: Map<String, dynamic>.from(raw as Map), currentUserId: widget.user['userId'].toString(), onTap: (c, title) async { await Navigator.push(context, MaterialPageRoute(builder: (_) => ConversationPage(conversationId: c['_id'].toString(), title: title, currentUserId: widget.user['userId'].toString()))); await load(); }),
    const SizedBox(height: 18), const Center(child: Text('Messages are not end-to-end encrypted in this version.', style: TextStyle(fontSize: 10, color: Color(0xFF9299AB))))
  ])));
}

class _ConversationTile extends StatelessWidget {
  final Map<String, dynamic> conversation; final String currentUserId; final void Function(Map<String, dynamic>, String) onTap;
  const _ConversationTile({required this.conversation, required this.currentUserId, required this.onTap});
  @override Widget build(BuildContext context) {
    final group = conversation['kind'] == 'group'; final members = (conversation['members'] as List<dynamic>? ?? []).map((e) => e.toString()).where((e) => e != currentUserId).toList();
    final title = group ? (conversation['name']?.toString().isNotEmpty == true ? conversation['name'].toString() : 'Group chat') : 'Chat with ${members.isEmpty ? 'contact' : members.first}';
    return Container(margin: const EdgeInsets.only(bottom: 9), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE9EBF3))), child: ListTile(contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 5), leading: CircleAvatar(backgroundColor: group ? const Color(0xFFEDEAFF) : const Color(0xFFE4F8F4), foregroundColor: group ? brand : const Color(0xFF249B87), child: Icon(group ? Icons.groups_rounded : Icons.person_rounded)), title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)), subtitle: Text(group ? '${(conversation['members'] as List<dynamic>? ?? []).length} members' : 'Tap to open conversation', style: const TextStyle(fontSize: 11, color: Color(0xFF8A91A5)),), trailing: const Icon(Icons.chevron_right_rounded, color: Color(0xFF9CA3B6)), onTap: () => onTap(conversation, title)));
  }
}

class ConversationPage extends StatefulWidget {
  final String conversationId, title, currentUserId;
  const ConversationPage({super.key, required this.conversationId, required this.title, required this.currentUserId});
  @override State<ConversationPage> createState() => _ConversationPageState();
}

class _ConversationPageState extends State<ConversationPage> {
  final text = TextEditingController(); final scroll = ScrollController();
  final recorder = AudioRecorder(); final player = AudioPlayer();
  final Set<String> seen = {}; List<Map<String, dynamic>> messages = [];
  bool sending = false, loading = true, recording = false, playingVoice = false; String error = ''; io.Socket? socket;
  @override void initState() { super.initState(); load(); connectRealtime(); }
  void connectRealtime() {
    if (Api.token == null) return;
    socket = io.io(AppConfig.apiBaseUrl, io.OptionBuilder().setTransports(['websocket']).setAuth({'token': Api.token}).disableAutoConnect().enableReconnection().build());
    socket!.onConnect((_) => socket!.emit('conversation:join', {'conversationId': widget.conversationId}));
    socket!.on('message:new', (dynamic raw) { if (!mounted || raw is! Map || raw['conversationId']?.toString() != widget.conversationId) return; _addMessage(Map<String, dynamic>.from(raw)); });
    socket!.onConnectError((_) { if (mounted) setState(() => error = 'Live updates are reconnecting.'); });
    socket!.connect();
  }
  void _addMessage(Map<String, dynamic> m) { final id = (m['id'] ?? m['_id'])?.toString(); if (id != null && !seen.add(id)) return; if (mounted) setState(() => messages.add(m)); }
  Future<void> load() async {
    try { final data = await Api.request('/api/conversations/${widget.conversationId}/messages', auth: true); final loaded = (data['messages'] as List<dynamic>).map((e) => Map<String, dynamic>.from(e as Map)).toList(); if (mounted) setState(() { messages = loaded; seen..clear()..addAll(loaded.map((m) => (m['id'] ?? m['_id']).toString())); error = ''; }); }
    catch (e) { if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', '')); }
    finally { if (mounted) setState(() => loading = false); }
  }
  Future<void> send() async {
    final value = text.text.trim(); if (value.isEmpty || sending) return;
    setState(() { sending = true; error = ''; });
    try { final data = await Api.request('/api/conversations/${widget.conversationId}/messages', method: 'POST', body: {'text': value}, auth: true); _addMessage(Map<String, dynamic>.from(data['message'] as Map)); text.clear(); }
    catch (e) { if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', '')); }
    finally { if (mounted) setState(() => sending = false); }
  }
  Future<void> startRecording() async {
    try {
      if (!await recorder.hasPermission()) { setState(() => error = 'Microphone permission is required to record a voice message.'); return; }
      final dir = await getTemporaryDirectory();
      final path = '${dir.path}/globalchat-${DateTime.now().millisecondsSinceEpoch}.m4a';
      await recorder.start(const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 64000, sampleRate: 24000), path: path);
      if (mounted) setState(() { recording = true; error = ''; });
    } catch (e) { if (mounted) setState(() => error = 'Could not start recording: ${e.toString()}'); }
  }
  Future<void> stopRecording() async {
    try {
      final path = await recorder.stop();
      if (mounted) setState(() => recording = false);
      if (path == null) return;
      final file = File(path); final bytes = await file.readAsBytes();
      if (bytes.isEmpty) return;
      if (bytes.length > 1800000) { if (mounted) setState(() => error = 'Voice note is too large. Keep recordings short and try again.'); return; }
      setState(() => sending = true);
      final data = await Api.request('/api/conversations/${widget.conversationId}/messages', method: 'POST', body: {'audioBase64': base64Encode(bytes), 'audioMimeType': 'audio/mp4'}, auth: true);
      _addMessage(Map<String, dynamic>.from(data['message'] as Map));
      await file.delete().catchError((_) => file);
    } catch (e) { if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', '')); }
    finally { if (mounted) setState(() => sending = false); }
  }
  Future<void> playVoice(Map<String, dynamic> message) async {
    final id = (message['id'] ?? message['_id'])?.toString();
    if (id == null) return;
    try {
      setState(() { playingVoice = true; error = ''; });
      final bytes = await Api.getBytes('/api/conversations/${widget.conversationId}/messages/$id/audio');
      await player.play(BytesSource(bytes));
    } catch (e) { if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', '')); }
    finally { if (mounted) setState(() => playingVoice = false); }
  }
  @override void dispose() { socket?.dispose(); text.dispose(); scroll.dispose(); unawaited(recorder.dispose()); unawaited(player.dispose()); super.dispose(); }
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Row(children: [CircleAvatar(radius: 18, backgroundColor: const Color(0xFFEDEAFF), child: const Icon(Icons.forum_rounded, color: brand, size: 18)), const SizedBox(width: 10), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(widget.title, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)), const Text('GlobalChat conversation', style: TextStyle(fontSize: 10, color: Color(0xFF8B92A5))) ]))])), body: Column(children: [if (recording) Container(width: double.infinity, color: const Color(0xFFFFF0F1), padding: const EdgeInsets.all(10), child: const Text('Recording voice note… tap the microphone again to send.', style: TextStyle(color: Color(0xFFB3344A), fontSize: 12, fontWeight: FontWeight.w600))), if (error.isNotEmpty) Container(width: double.infinity, color: const Color(0xFFFFF0F1), padding: const EdgeInsets.all(10), child: Text(error, style: const TextStyle(color: Color(0xFFB3344A), fontSize: 12))), Expanded(child: loading ? const Center(child: CircularProgressIndicator(color: brand)) : messages.isEmpty ? const Center(child: Column(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.waving_hand_rounded, size: 42, color: Color(0xFFB7B0F7)), SizedBox(height: 12), Text('Say hello 👋', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: ink)), SizedBox(height: 5), Text('Your conversation starts here.', style: TextStyle(color: Color(0xFF8A91A5), fontSize: 12))])) : ListView.builder(controller: scroll, padding: const EdgeInsets.all(14), itemCount: messages.length, itemBuilder: (context, index) { final m = messages[index]; final mine = m['senderId']?.toString() == widget.currentUserId; return Align(alignment: mine ? Alignment.centerRight : Alignment.centerLeft, child: Container(constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * .78), margin: const EdgeInsets.symmetric(vertical: 4), padding: const EdgeInsets.fromLTRB(14, 10, 14, 8), decoration: BoxDecoration(color: mine ? brand : Colors.white, borderRadius: BorderRadius.only(topLeft: const Radius.circular(17), topRight: const Radius.circular(17), bottomLeft: Radius.circular(mine ? 17 : 5), bottomRight: Radius.circular(mine ? 5 : 17)), border: mine ? null : Border.all(color: const Color(0xFFE7EAF2))), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [if (m['messageType'] == 'voice') Row(mainAxisSize: MainAxisSize.min, children: [IconButton(onPressed: playingVoice ? null : () => playVoice(m), icon: Icon(Icons.play_circle_fill_rounded, color: mine ? Colors.white : brand, size: 28), padding: EdgeInsets.zero, constraints: const BoxConstraints(minWidth: 34, minHeight: 34)), Text('Voice message', style: TextStyle(color: mine ? Colors.white : ink, fontWeight: FontWeight.w600))]) else Text(m['text']?.toString() ?? '', style: TextStyle(color: mine ? Colors.white : ink, height: 1.4)), const SizedBox(height: 4), Text(m['createdAt'] == null ? '' : _time(m['createdAt'].toString()), style: TextStyle(color: mine ? Colors.white70 : const Color(0xFF9299AB), fontSize: 9))]))); })), SafeArea(top: false, child: Container(padding: const EdgeInsets.fromLTRB(12, 10, 12, 12), decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: Color(0xFFE8EAF2)))), child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [IconButton(tooltip: recording ? 'Stop and send voice note' : 'Record voice note', onPressed: sending ? null : (recording ? stopRecording : startRecording), icon: Icon(recording ? Icons.stop_circle_rounded : Icons.mic_rounded, color: recording ? Colors.redAccent : brand, size: 27)), Expanded(child: TextField(controller: text, minLines: 1, maxLines: 5, onSubmitted: (_) => send(), decoration: const InputDecoration(hintText: 'Write a message…', filled: true, fillColor: Color(0xFFF6F7FC), border: OutlineInputBorder(borderSide: BorderSide.none), enabledBorder: OutlineInputBorder(borderSide: BorderSide.none)))), const SizedBox(width: 8), SizedBox(width: 49, height: 49, child: FilledButton(onPressed: sending ? null : send, style: FilledButton.styleFrom(padding: EdgeInsets.zero, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15))), child: sending ? const SizedBox(width: 17, height: 17, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : const Icon(Icons.send_rounded, size: 20))) ]))) ]));
}

String _time(String value) { final d = DateTime.tryParse(value)?.toLocal(); if (d == null) return ''; final h = d.hour % 12 == 0 ? 12 : d.hour % 12; return '$h:${d.minute.toString().padLeft(2, '0')} ${d.hour >= 12 ? 'PM' : 'AM'}'; }

class _FieldLabel extends StatelessWidget { final String text; const _FieldLabel(this.text); @override Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(bottom: 7), child: Text(text, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: Color(0xFF858DA2), letterSpacing: 1.2))); }
class _ErrorBanner extends StatelessWidget { final String text; const _ErrorBanner(this.text); @override Widget build(BuildContext context) => Container(padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: const Color(0xFFFFEFF1), borderRadius: BorderRadius.circular(12)), child: Text(text, style: const TextStyle(color: Color(0xFFB3344A), fontSize: 12))); }
class _SignedOut extends StatelessWidget { const _SignedOut(); @override Widget build(BuildContext context) => AuthPage(onAuthenticated: (user) { Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => ChatHome(user: user))); }); }
