import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'app_config.dart';

void main() => runApp(const GlobalChatApp());
const secureStorage = FlutterSecureStorage();

class GlobalChatApp extends StatelessWidget {
  const GlobalChatApp({super.key});
  @override Widget build(BuildContext context) => MaterialApp(title: 'GlobalChat', debugShowCheckedModeBanner: false, theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff315cff)), useMaterial3: true), home: const AuthPage());
}

class Api {
  static String? token;
  static Future<Map<String,dynamic>> request(String path,{String method='GET',Map<String,dynamic>? body,bool auth=false}) async {
    final base=AppConfig.apiBaseUrl;
    if(base.contains('YOUR-BACKEND')) throw Exception('Set apiBaseUrl in lib/app_config.dart to your deployed backend URL.');
    final headers=<String,String>{'Content-Type':'application/json'};
    if(auth && token!=null) headers['Authorization']='Bearer $token';
    final uri=Uri.parse('$base$path');
    final response=method=='POST'?await http.post(uri,headers:headers,body:jsonEncode(body??{})):method=='PUT'?await http.put(uri,headers:headers,body:jsonEncode(body??{})):await http.get(uri,headers:headers);
    final data=jsonDecode(response.body) as Map<String,dynamic>;
    if(response.statusCode<200||response.statusCode>=300) throw Exception(data['error']??'Request failed (${response.statusCode})');
    return data;
  }
}

class AuthPage extends StatefulWidget { const AuthPage({super.key}); @override State<AuthPage> createState()=>_AuthPageState(); }
class _AuthPageState extends State<AuthPage> {
  final name=TextEditingController(), id=TextEditingController(), password=TextEditingController(); bool register=true,busy=false; String message='';
  Future<void> submit() async { setState(()=>{busy=true,message='' }); try { final data=await Api.request(register?'/api/auth/register':'/api/auth/login',method:'POST',body:register?{'displayName':name.text.trim(),'password':password.text}:{'userId':id.text.trim(),'password':password.text}); Api.token=data['token'] as String; await secureStorage.write(key:'token',value:Api.token); await secureStorage.write(key:'userId',value:data['user']['userId'].toString()); if(!mounted)return; Navigator.of(context).pushReplacement(MaterialPageRoute(builder:(_)=>ChatHome(userId:data['user']['userId'].toString(),displayName:data['user']['displayName'].toString()))); } catch(e){setState(()=>message=e.toString().replaceFirst('Exception: ',''));} finally {if(mounted)setState(()=>busy=false);} }
  @override Widget build(BuildContext context)=>Scaffold(body:Center(child:SingleChildScrollView(padding:const EdgeInsets.all(24),child:ConstrainedBox(constraints:const BoxConstraints(maxWidth:440),child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[const Icon(Icons.forum_rounded,size:58,color:Color(0xff315cff)),const SizedBox(height:12),const Text('GlobalChat',textAlign:TextAlign.center,style:TextStyle(fontSize:32,fontWeight:FontWeight.bold)),const Text('Connect using a unique numeric ID',textAlign:TextAlign.center),const SizedBox(height:28),if(register)TextField(controller:name,decoration:const InputDecoration(labelText:'Display name',border:OutlineInputBorder())),if(!register)Padding(padding:const EdgeInsets.only(bottom:12),child:TextField(controller:id,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'Numeric user ID',border:OutlineInputBorder()))),if(register)const SizedBox(height:12),TextField(controller:password,obscureText:true,decoration:const InputDecoration(labelText:'Password (minimum 10 characters)',border:OutlineInputBorder())),const SizedBox(height:16),if(message.isNotEmpty)Text(message,style:const TextStyle(color:Colors.red)),FilledButton(onPressed:busy?null:submit,child:Text(busy?'Please wait…':register?'Create account':'Log in')),TextButton(onPressed:()=>setState(()=>{register=!register,message=''}),child:Text(register?'Already registered? Log in':'Create a new account')),const SizedBox(height:12),const Text('Security notice: end-to-end encryption is not implemented in this starter. Do not use for sensitive messages.',style:TextStyle(fontSize:12,color:Colors.redAccent))])))));
}

class ChatHome extends StatefulWidget { final String userId,displayName; const ChatHome({super.key,required this.userId,required this.displayName}); @override State<ChatHome> createState()=>_ChatHomeState(); }
class _ChatHomeState extends State<ChatHome> {
  final otherId=TextEditingController(); bool busy=false; String status=''; List<dynamic> conversations=[];
  @override void initState(){super.initState();load();}
  Future<void> load() async {try{final d=await Api.request('/api/conversations',auth:true);setState(()=>conversations=d['conversations'] as List<dynamic>);}catch(e){setState(()=>status=e.toString());}}
  Future<void> startChat() async {setState(()=>busy=true);try{final d=await Api.request('/api/conversations/direct',method:'POST',body:{'otherUserId':otherId.text.trim()},auth:true);final c=d['conversation'] as Map<String,dynamic>;if(!mounted)return;await Navigator.push(context,MaterialPageRoute(builder:(_)=>ConversationPage(conversationId:c['_id'].toString(),title:'Conversation')));await load();}catch(e){setState(()=>status=e.toString().replaceFirst('Exception: ',''));}finally{if(mounted)setState(()=>busy=false);}}
  @override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:Text('GlobalChat · ${widget.userId}'),actions:[IconButton(onPressed:()async{await secureStorage.deleteAll();if(mounted)Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder:(_)=>const AuthPage()),(_)=>false);},icon:const Icon(Icons.logout))]),body:RefreshIndicator(onRefresh:load,child:ListView(padding:const EdgeInsets.all(16),children:[Text('Hello, ${widget.displayName}',style:Theme.of(context).textTheme.titleLarge),const SizedBox(height:16),TextField(controller:otherId,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'Start chat with numeric ID',border:OutlineInputBorder())),const SizedBox(height:8),FilledButton(onPressed:busy?null:startChat,child:const Text('Start conversation')),if(status.isNotEmpty)Text(status,style:const TextStyle(color:Colors.red)),const Divider(height:32),const Text('Your conversations',style:TextStyle(fontWeight:FontWeight.bold)),for(final c in conversations)ListTile(leading:const CircleAvatar(child:Icon(Icons.person)),title:Text(c['kind']=='group'?(c['name']??'Group').toString():'Direct conversation'),subtitle:Text('ID: ${c['_id']}'),onTap:()=>Navigator.push(context,MaterialPageRoute(builder:(_)=>ConversationPage(conversationId:c['_id'].toString(),title:c['kind']=='group'?(c['name']??'Group').toString():'Conversation'))).then((_)=>load())),if(conversations.isEmpty)const Padding(padding:EdgeInsets.all(20),child:Text('No conversations yet. Start one using a numeric ID.'))])));
}

class ConversationPage extends StatefulWidget { final String conversationId,title; const ConversationPage({super.key,required this.conversationId,required this.title}); @override State<ConversationPage> createState()=>_ConversationPageState(); }
class _ConversationPageState extends State<ConversationPage> {
  final text=TextEditingController(); List<dynamic> messages=[]; bool sending=false; String error=''; io.Socket? socket;
  @override void initState(){super.initState();load();connectRealtime();}
  void connectRealtime(){ final base=AppConfig.apiBaseUrl; if(base.contains('YOUR-BACKEND')||Api.token==null)return; socket=io.io(base,io.OptionBuilder().setTransports(['websocket']).setAuth({'token':Api.token}).disableAutoConnect().build()); socket!.onConnect((_)=>socket!.emit('conversation:join',{'conversationId':widget.conversationId})); socket!.on('message:new',(dynamic raw){ if(!mounted||raw is! Map)return; final id=raw['id']?.toString(); if(messages.any((m)=>m['id']?.toString()==id||m['_id']?.toString()==id))return; setState(()=>messages.add(Map<String,dynamic>.from(raw))); }); socket!.connect(); }
  Future<void> load()async{try{final d=await Api.request('/api/conversations/${widget.conversationId}/messages',auth:true);setState(()=>messages=d['messages'] as List<dynamic>);}catch(e){setState(()=>error=e.toString());}}
  Future<void> send()async{final value=text.text.trim();if(value.isEmpty)return;setState(()=>sending=true);try{final d=await Api.request('/api/conversations/${widget.conversationId}/messages',method:'POST',body:{'text':value},auth:true);setState(()=>messages.add(d['message']));text.clear();}catch(e){setState(()=>error=e.toString().replaceFirst('Exception: ',''));}finally{if(mounted)setState(()=>sending=false);}}
  @override void dispose(){socket?.dispose();text.dispose();super.dispose();}
  @override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:Text(widget.title)),body:Column(children:[Expanded(child:RefreshIndicator(onRefresh:load,child:ListView(padding:const EdgeInsets.all(12),children:[if(error.isNotEmpty)Text(error,style:const TextStyle(color:Colors.red)),for(final m in messages)Align(alignment:Alignment.centerLeft,child:Container(margin:const EdgeInsets.symmetric(vertical:5),padding:const EdgeInsets.all(12),decoration:BoxDecoration(color:Theme.of(context).colorScheme.surfaceContainerHighest,borderRadius:BorderRadius.circular(12)),child:Text('${m['text']??''}\n${m['senderId']??''}')))]))),SafeArea(child:Padding(padding:const EdgeInsets.all(8),child:Row(children:[Expanded(child:TextField(controller:text,decoration:const InputDecoration(hintText:'Message…',border:OutlineInputBorder()),onSubmitted:(_)=>send())),IconButton(onPressed:sending?null:send,icon:const Icon(Icons.send))])))]));
}
