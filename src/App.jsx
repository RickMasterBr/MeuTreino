import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate, useParams } from 'react-router-dom';
import { collection, getDocs, addDoc, doc, getDoc, updateDoc, arrayUnion, arrayRemove, query, orderBy, where, deleteDoc, setDoc } from 'firebase/firestore';
import { signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { db, auth, provider } from './firebase'; // Importando o que acabamos de criar
import './App.css';
// --- PÁGINAS (Componentes que vão renderizar no conteúdo principal) ---

function Feed() {
  const [feed, setFeed] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const navigate = useNavigate();
  const [abaAtual, setAbaAtual] = useState('global'); // 'global' ou 'seguindo'

  useEffect(() => {
    const carregarFeed = async () => {
      setCarregando(true);
      try {
        let treinosSnap;

        if (abaAtual === 'global') {
          // Traz tudo ordenado por data
          const q = query(collection(db, 'workouts'), orderBy('data', 'desc'));
          treinosSnap = await getDocs(q);
        } else {
          // Lógica da aba "Seguindo"
          const user = auth.currentUser;
          if (!user) return;

          const userDoc = await getDoc(doc(db, 'users', user.uid));
          let listaSeguindo = userDoc.exists() ? userDoc.data().seguindo || [] : [];
          
          // Adiciona o seu próprio ID para ver os seus treinos também
          listaSeguindo.push(user.uid);

          // O Firebase aceita no máximo 30 IDs num 'in'. Cortamos por segurança no MVP.
          const idsParaBuscar = listaSeguindo.slice(0, 30);

          if (idsParaBuscar.length > 0) {
            const q = query(collection(db, 'workouts'), where('userId', 'in', idsParaBuscar));
            treinosSnap = await getDocs(q);
          } else {
            treinosSnap = { docs: [] }; // Se não segue ninguém, array vazio
          }
        }

        const treinosComVolume = treinosSnap.docs.map(doc => {
          // ... (MANTENHA AQUI O CÁLCULO DE VOLUME E RETORNO EXATAMENTE COMO VOCÊ JÁ TINHA) ...
          const dados = doc.data();
          let volumeTreino = 0;
          if (dados.exerciciosRealizados) {
            dados.exerciciosRealizados.forEach(ex => {
              if (ex.series) {
                ex.series.forEach(serie => {
                  if (serie.concluida && serie.peso && serie.reps) {
                    volumeTreino += (Number(serie.peso) * Number(serie.reps));
                  }
                });
              }
            });
          }
          return { id: doc.id, ...dados, volume: volumeTreino };
        });

        // Ordenamos via JavaScript para evitar ter que configurar Índices Compostos no Firebase para o MVP
        treinosComVolume.sort((a, b) => b.data.seconds - a.data.seconds);

        setFeed(treinosComVolume);
      } catch (erro) {
        console.error("Erro ao carregar feed:", erro);
      } finally {
        setCarregando(false);
      }
    };

    carregarFeed();
  }, [abaAtual]); // Recarrega o feed quando a aba mudar

  const alternarLike = async (treinoId, likesAtuais) => {
    const user = auth.currentUser;
    if (!user) {
      alert("Precisa de iniciar sessão para gostar de um treino!");
      return;
    }

    const treinoRef = doc(db, 'workouts', treinoId);
    // Verifica se o array existe e se o ID do utilizador já lá está
    const jaGostou = likesAtuais && likesAtuais.includes(user.uid);

    try {
      if (jaGostou) {
        // Se já gostou, remove o ID do array
        await updateDoc(treinoRef, {
          likes: arrayRemove(user.uid)
        });
      } else {
        // Se não gostou, adiciona o ID ao array
        await updateDoc(treinoRef, {
          likes: arrayUnion(user.uid)
        });
      }

      // Atualiza o estado local para o coração mudar de cor imediatamente (sem recarregar a página)
      setFeed(feedAnterior => feedAnterior.map(treino => {
        if (treino.id === treinoId) {
          const novosLikes = jaGostou 
            ? treino.likes.filter(id => id !== user.uid) 
            : [...(treino.likes || []), user.uid];
          return { ...treino, likes: novosLikes };
        }
        return treino;
      }));

    } catch (erro) {
      console.error("Erro ao alternar gosto:", erro);
    }
  };

  // Estado para controlar o texto que está a ser digitado em cada post específico
  const [comentariosInputs, setComentariosInputs] = useState({});

  // Função para atualizar o texto do input
  const atualizarTextoComentario = (treinoId, texto) => {
    setComentariosInputs(prev => ({ ...prev, [treinoId]: texto }));
  };

  // Função para enviar o comentário para o Firebase
  const adicionarComentario = async (treinoId) => {
    const texto = comentariosInputs[treinoId];
    if (!texto || !texto.trim()) return; // Não envia comentários vazios

    const user = auth.currentUser;
    if (!user) {
      alert("Inicie sessão para comentar!");
      return;
    }

    // Criamos o objeto do comentário com um ID único baseado na data
    const novoComentario = {
      id: Date.now().toString(),
      userId: user.uid,
      userName: user.displayName || 'Atleta',
      texto: texto,
      data: new Date()
    };

    try {
      const treinoRef = doc(db, 'workouts', treinoId);
      
      // Injeta o objeto do comentário no array 'comentarios' no Firebase
      await updateDoc(treinoRef, {
        comentarios: arrayUnion(novoComentario)
      });

      // Atualiza a tela imediatamente (estado local)
      setFeed(feedAnterior => feedAnterior.map(treino => {
        if (treino.id === treinoId) {
          return { ...treino, comentarios: [...(treino.comentarios || []), novoComentario] };
        }
        return treino;
      }));

      // Limpa o input daquele treino específico
      setComentariosInputs(prev => ({ ...prev, [treinoId]: '' }));

    } catch (erro) {
      console.error("Erro ao adicionar comentário:", erro);
    }
  };

  return (
    <div>
      <h1 className="page-title">Feed da Comunidade</h1>

      {/* Abas de Navegação do Feed */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginBottom: '30px', borderBottom: '1px solid #2c2c2e', paddingBottom: '10px' }}>
        <button 
          onClick={() => setAbaAtual('global')}
          style={{ background: 'none', border: 'none', color: abaAtual === 'global' ? 'white' : '#8e8e93', fontWeight: abaAtual === 'global' ? 'bold' : 'normal', fontSize: '16px', cursor: 'pointer' }}
        >
          Global
        </button>
        <button 
          onClick={() => setAbaAtual('seguindo')}
          style={{ background: 'none', border: 'none', color: abaAtual === 'seguindo' ? 'white' : '#8e8e93', fontWeight: abaAtual === 'seguindo' ? 'bold' : 'normal', fontSize: '16px', cursor: 'pointer' }}
        >
          A Seguir
        </button>
      </div>

      <div className="routines-list" style={{ maxWidth: '600px', margin: '0 auto' }}>
        {carregando ? (
          <p style={{ color: 'white', textAlign: 'center' }}>Carregando treinos...</p>
        ) : feed.length === 0 ? (
          <p style={{ color: 'gray', textAlign: 'center' }}>Nenhum treino na comunidade ainda. Seja o primeiro!</p>
        ) : (
          feed.map(treino => (
            <div key={treino.id} style={{ backgroundColor: '#1c1c1e', padding: '20px', borderRadius: '12px', marginBottom: '20px' }}>
              
              {/* Cabeçalho do Post Clicável (Quem fez e quando) */}
              <div 
                onClick={() => navigate(`/user/${treino.userId}`)}
                style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '15px', cursor: 'pointer', padding: '5px', borderRadius: '8px', transition: 'background-color 0.2s' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#2c2c2e'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                {treino.userPhoto ? (
                  <img src={treino.userPhoto} alt="Perfil" style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '40px', height: '40px', backgroundColor: '#333', borderRadius: '50%' }}></div>
                )}
                <div>
                  <h4 style={{ margin: 0, fontSize: '16px' }}>{treino.userName || 'Usuário Desconhecido'}</h4>
                  <span style={{ color: '#8e8e93', fontSize: '12px' }}>
                    {treino.data ? new Date(treino.data.seconds * 1000).toLocaleString() : ''}
                  </span>
                </div>
              </div>

              {/* Título do Treino e Volume */}
              <div style={{ marginBottom: '15px' }}>
                <h3 style={{ margin: 0, fontSize: '20px', color: '#1a73e8' }}>{treino.nome}</h3>
                <p style={{ color: '#8e8e93', fontSize: '14px', marginTop: '5px' }}>
                  Volume total: <strong style={{ color: 'white' }}>{treino.volume} kg</strong>
                </p>
              </div>

              {/* --- TROFÉU DE RECORDES PESSOAIS --- */}
              {treino.recordesQuebrados && treino.recordesQuebrados.length > 0 && (
                <div style={{ backgroundColor: '#ffd70015', border: '1px solid #ffd70040', padding: '10px 15px', borderRadius: '8px', marginBottom: '15px' }}>
                  <p style={{ color: '#ffd700', margin: 0, fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>🏆</span> Novo Recorde Pessoal (PR)
                  </p>
                  <p style={{ color: '#e0e0e0', margin: '5px 0 0 0', fontSize: '13px' }}>
                    {treino.recordesQuebrados.join(', ')}
                  </p>
                </div>
              )}

              {/* Lista Resumida de Exercícios */}
              <div style={{ backgroundColor: '#121212', padding: '15px', borderRadius: '8px' }}>
                {treino.exerciciosRealizados && treino.exerciciosRealizados.map((ex, idx) => {
                  const seriesFeitas = ex.series ? ex.series.filter(s => s.concluida).length : 0;
                  
                  if (seriesFeitas === 0) return null;

                  // Pega a melhor série (mais pesada) para mostrar de destaque
                  const melhorSerie = ex.series
                    .filter(s => s.concluida)
                    .sort((a, b) => Number(b.peso) - Number(a.peso))[0];

                  return (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid #222', paddingBottom: '8px' }}>
                      <span style={{ color: 'white', fontSize: '14px' }}>
                        <strong style={{ color: '#8e8e93' }}>{seriesFeitas}x</strong> {ex.nome}
                      </span>
                      <span style={{ color: '#8e8e93', fontSize: '14px' }}>
                        Melhor: {melhorSerie.peso}kg x {melhorSerie.reps}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Barra de Interação Social */}
              <div style={{ display: 'flex', gap: '15px', marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #2c2c2e' }}>
                <button 
                  onClick={() => alternarLike(treino.id, treino.likes)}
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    cursor: 'pointer', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px', 
                    fontSize: '15px', 
                    fontWeight: 'bold',
                    color: (treino.likes && treino.likes.includes(auth.currentUser?.uid)) ? '#e53935' : '#8e8e93'
                  }}
                >
                  {/* Se o utilizador já deu like, mostra o coração vermelho; senão, mostra um coração vazio/branco */}
                  <span>{(treino.likes && treino.likes.includes(auth.currentUser?.uid)) ? '❤️' : '🤍'}</span>
                  {treino.likes ? treino.likes.length : 0} Likes
                </button>
                
                <button style={{ background: 'none', border: 'none', color: '#8e8e93', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', fontWeight: 'bold' }}>
                  <span>💬</span> Comentar
                </button>
              </div>

              {/* --- SECÇÃO DE COMENTÁRIOS --- */}
              <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #222' }}>
                
                {/* Lista de Comentários Existentes */}
                {treino.comentarios && treino.comentarios.length > 0 && (
                  <div style={{ marginBottom: '15px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {treino.comentarios.map(comentario => (
                      <div key={comentario.id} style={{ fontSize: '14px', backgroundColor: '#121212', padding: '10px', borderRadius: '8px' }}>
                        <strong style={{ color: '#1a73e8', marginRight: '5px' }}>{comentario.userName}:</strong>
                        <span style={{ color: '#e0e0e0' }}>{comentario.texto}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Input para Escrever Novo Comentário */}
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input 
                    type="text" 
                    placeholder="Adicionar um comentário..."
                    value={comentariosInputs[treino.id] || ''}
                    onChange={(e) => atualizarTextoComentario(treino.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') adicionarComentario(treino.id); // Permite enviar com a tecla Enter
                    }}
                    style={{ flex: 1, padding: '10px', borderRadius: '20px', border: 'none', backgroundColor: '#2c2c2e', color: 'white', fontSize: '14px', outline: 'none', paddingLeft: '15px' }}
                  />
                  <button 
                    onClick={() => adicionarComentario(treino.id)}
                    style={{ background: 'none', border: 'none', color: '#1a73e8', fontWeight: 'bold', cursor: 'pointer', padding: '0 10px' }}
                  >
                    Postar
                  </button>
                </div>
              </div>

            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Routines() {
  // 1. Estado para guardar as rotinas que vêm da base de dados
  const [minhasRotinas, setMinhasRotinas] = useState([]);
  const [aCarregar, setACarregar] = useState(true);
  const navigate = useNavigate();

  // 2. Função para ir buscar as rotinas ao Firebase
  const carregarRotinas = async () => {
    setACarregar(true);
    try {
      const user = auth.currentUser; // Pega o usuário logado
      if (!user) return; // Segurança caso não tenha carregado ainda

      // NOVA QUERY: Busca na coleção routines ONDE o userId seja igual ao id do usuário
      const q = query(collection(db, 'routines'), where('userId', '==', user.uid));
      const snapshot = await getDocs(q);

      const listaRotinas = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setMinhasRotinas(listaRotinas);
    } catch (erro) {
      console.error("Erro ao carregar rotinas:", erro);
    } finally {
      setACarregar(false);
    }
  };

  // 3. O useEffect faz com que as rotinas sejam carregadas assim que o ecrã abre
  useEffect(() => {
    carregarRotinas();
  }, []);

  // 4. Função para criar uma rotina nova quando clicamos no botão
  const criarNovaRotina = async () => {
    try {
      const user = auth.currentUser;
      const rotinasRef = collection(db, 'routines');

      await addDoc(rotinasRef, {
        userId: user.uid, // <-- O SEGREDO ESTÁ AQUI: Carimbando de quem é a rotina
        nome: 'Nova Rotina ' + Math.floor(Math.random() * 100),
        exerciciosDetalhados: [],
        dataCriacao: new Date()
      });

      carregarRotinas();
    } catch (erro) {
      console.error("Erro ao criar rotina:", erro);
    }
  };

  const excluirRotina = async (id, e) => {
    e.stopPropagation(); // Impede que o clique "vaze" para o card e abra a rotina

    if (!window.confirm("Deseja mesmo excluir esta rotina inteira?")) return;

    try {
      await deleteDoc(doc(db, 'routines', id));
      carregarRotinas(); // Recarrega a lista
    } catch (erro) {
      console.error("Erro ao excluir rotina:", erro);
    }
  };

  return (
    <div>
      <h1 className="page-title">Routines</h1>

      <div className="routines-container">

        {/* Coluna da Esquerda: Lista de Rotinas */}
        <div className="routines-list">
          <p style={{ color: 'gray', marginBottom: '10px', fontSize: '14px' }}>
            My Routines ({minhasRotinas.length})
          </p>

          {aCarregar ? (
            <p style={{ color: 'white' }}>A carregar da base de dados...</p>
          ) : minhasRotinas.length === 0 ? (
            <p style={{ color: 'gray' }}>Ainda não tem rotinas. Crie a primeira!</p>
          ) : (
            minhasRotinas.map((rotina) => (
              <div key={rotina.id} className="routine-card" onClick={() => navigate(`/routines/${rotina.id}`)}>
                <div className="routine-header">
                  <span className="routine-title">{rotina.nome}</span>
                  <div>
                    <button
                      onClick={(e) => excluirRotina(rotina.id, e)}
                      style={{ background: 'none', border: 'none', color: '#ff4d4d', marginRight: '15px', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                      Excluir
                    </button>
                    <span style={{ color: 'gray' }}>•••</span>
                  </div>
                </div>
                <div className="routine-exercises">
                  {rotina.exercicios}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Coluna da Direita: Botões de Ação */}
        <div className="routines-actions">
          {/* Ligamos a função criarNovaRotina ao clique deste botão */}
          <button className="btn-secondary" onClick={criarNovaRotina}>
            <span>📄</span> New Routine
          </button>
          <button className="btn-secondary">
            <span>📁</span> New Folder
          </button>
        </div>

      </div>
    </div>
  );
}

function Exercises() {
  const [listaExercicios, setListaExercicios] = useState([]);
  const [novoExercicio, setNovoExercicio] = useState('');
  const [carregando, setCarregando] = useState(true);

  // 1. Busca os exercícios do usuário no Firebase
  const carregarExercicios = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const q = query(collection(db, 'exercises'), where('userId', '==', user.uid));
      const snapshot = await getDocs(q);

      const exercicios = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setListaExercicios(exercicios);
    } catch (erro) {
      console.error("Erro ao carregar exercícios:", erro);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarExercicios();
  }, []);

  // 2. Salva um novo exercício no banco
  const criarExercicio = async () => {
    if (!novoExercicio.trim()) return; // Não deixa criar vazio

    try {
      const user = auth.currentUser;
      await addDoc(collection(db, 'exercises'), {
        userId: user.uid,
        nome: novoExercicio,
        dataCriacao: new Date()
      });

      setNovoExercicio(''); // Limpa o input
      carregarExercicios(); // Recarrega a lista
    } catch (erro) {
      console.error("Erro ao criar exercício:", erro);
    }
  };

  const excluirExercicio = async (id) => {
    // Confirmação nativa do navegador para evitar exclusão acidental
    if (!window.confirm("Tem certeza que deseja excluir este exercício?")) return;

    try {
      await deleteDoc(doc(db, 'exercises', id));
      carregarExercicios(); // Recarrega a lista após excluir
    } catch (erro) {
      console.error("Erro ao excluir exercício:", erro);
      alert("Erro ao excluir.");
    }
  };

  return (
    <div>
      <h1 className="page-title">Exercises</h1>

      {/* Formulário para adicionar novo exercício */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '30px' }}>
        <input
          type="text"
          value={novoExercicio}
          onChange={(e) => setNovoExercicio(e.target.value)}
          placeholder="Ex: Supino Inclinado (Halter)"
          style={{ flex: 1, padding: '15px', borderRadius: '8px', border: 'none', backgroundColor: '#1c1c1e', color: 'white', fontSize: '16px' }}
        />
        <button
          onClick={criarExercicio}
          style={{ backgroundColor: '#1a73e8', color: 'white', border: 'none', padding: '0 20px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
        >
          Adicionar
        </button>
      </div>

      {/* Lista de exercícios cadastrados */}
      <div className="routines-list">
        {carregando ? (
          <p style={{ color: 'white' }}>Carregando catálogo...</p>
        ) : listaExercicios.length === 0 ? (
          <p style={{ color: 'gray' }}>Nenhum exercício cadastrado. Crie o primeiro!</p>
        ) : (
          listaExercicios.map(ex => (
            <div key={ex.id} style={{ backgroundColor: '#1c1c1e', padding: '15px 20px', borderRadius: '8px', marginBottom: '10px' }}>
              <span style={{ fontSize: '16px', color: 'white' }}>{ex.nome}</span>
              <button
                onClick={() => excluirExercicio(ex.id)}
                style={{ background: 'none', border: 'none', color: '#ff4d4d', fontWeight: 'bold', cursor: 'pointer', fontSize: '16px' }}
              >
                X
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Profile() {
  const [historico, setHistorico] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [estatisticas, setEstatisticas] = useState({ totalTreinos: 0, volumeTotal: 0 });

  useEffect(() => {
    const carregarHistorico = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        // Busca apenas os treinos deste usuário
        const q = query(collection(db, 'workouts'), where('userId', '==', user.uid));
        const snapshot = await getDocs(q);

        let volumeCalc = 0;
        const treinosRealizados = snapshot.docs.map(doc => {
          const dados = doc.data();
          let volumeTreino = 0;

          if (dados.exerciciosRealizados) {
            dados.exerciciosRealizados.forEach(ex => {
              if (ex.series) {
                ex.series.forEach(serie => {
                  if (serie.concluida && serie.peso && serie.reps) {
                    volumeTreino += (Number(serie.peso) * Number(serie.reps));
                  }
                });
              }
            });
          }

          volumeCalc += volumeTreino;

          return { id: doc.id, ...dados, volume: volumeTreino };
        });

        // Ordena do mais recente para o mais antigo usando JavaScript
        treinosRealizados.sort((a, b) => b.data.seconds - a.data.seconds);

        setHistorico(treinosRealizados);
        setEstatisticas({
          totalTreinos: treinosRealizados.length,
          volumeTotal: volumeCalc
        });

      } catch (erro) {
        console.error("Erro ao carregar histórico:", erro);
      } finally {
        setCarregando(false);
      }
    };

    carregarHistorico();
  }, []);

  if (carregando) return <p style={{ color: 'white', padding: '20px' }}>Carregando estatísticas...</p>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '30px' }}>
        {/* Foto de perfil genérica redonda */}
        <div style={{ width: '80px', height: '80px', backgroundColor: '#333', borderRadius: '50%' }}></div>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>Meu Perfil</h1>
          <p style={{ color: '#8e8e93', margin: 0 }}>Atleta</p>
        </div>
      </div>

      {/* Estatísticas (Workouts e Volume) */}
      <div style={{ backgroundColor: '#1c1c1e', padding: '20px', borderRadius: '12px', marginBottom: '30px', display: 'flex', gap: '40px' }}>
        <div>
          <p style={{ color: '#8e8e93', fontSize: '14px', marginBottom: '5px' }}>Workouts</p>
          <h2 style={{ margin: 0 }}>{estatisticas.totalTreinos}</h2>
        </div>
        <div>
          <p style={{ color: '#8e8e93', fontSize: '14px', marginBottom: '5px' }}>Volume Total</p>
          <h2 style={{ margin: 0 }}>{estatisticas.volumeTotal} kg</h2>
        </div>
      </div>

      <h3 style={{ marginBottom: '20px' }}>Latest Activity</h3>

      {/* Lista de treinos finalizados */}
      <div className="routines-list">
        {historico.length === 0 ? (
          <p style={{ color: 'gray' }}>Você ainda não finalizou nenhum treino.</p>
        ) : (
          historico.map(treino => (
            <div key={treino.id} style={{ backgroundColor: '#1c1c1e', padding: '20px', borderRadius: '12px', marginBottom: '15px' }}>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                <h3 style={{ margin: 0 }}>{treino.nome}</h3>
                <span style={{ color: '#8e8e93', fontSize: '14px' }}>
                  {/* Converte a data do Firebase para uma data legível */}
                  {treino.data ? new Date(treino.data.seconds * 1000).toLocaleDateString() : ''}
                </span>
              </div>

              <p style={{ color: '#8e8e93', fontSize: '14px', marginBottom: '15px' }}>
                Volume: <strong style={{ color: 'white' }}>{treino.volume} kg</strong>
              </p>

              {/* Lista resumida dos exercícios feitos no treino */}
              <div>
                {treino.exerciciosRealizados && treino.exerciciosRealizados.map((ex, idx) => {
                  const seriesFeitas = ex.series ? ex.series.filter(s => s.concluida).length : 0;

                  // Se não completou nenhuma série desse exercício, nem mostra no resumo
                  if (seriesFeitas === 0) return null;

                  return (
                    <p key={idx} style={{ color: 'white', fontSize: '14px', margin: '5px 0' }}>
                      <span style={{ color: '#1a73e8', fontWeight: 'bold' }}>{seriesFeitas} sets</span> {ex.nome}
                    </p>
                  );
                })}
              </div>

            </div>
          ))
        )}
      </div>
    </div>
  );
}

function UserProfile() {
  const { id } = useParams(); // Pega o ID do amigo na URL
  const navigate = useNavigate();
  const [historico, setHistorico] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [estatisticas, setEstatisticas] = useState({ totalTreinos: 0, volumeTotal: 0 });
  const [dadosAmigo, setDadosAmigo] = useState({ nome: 'Atleta', foto: '' });
  const [seguindo, setSeguindo] = useState(false);

  // Verifica se o utilizador logado já segue este perfil
  useEffect(() => {
    const verificarFollow = async () => {
      const user = auth.currentUser;
      if (!user) return;

      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          const listaSeguindo = userSnap.data().seguindo || [];
          setSeguindo(listaSeguindo.includes(id)); // 'id' é o ID do amigo da URL
        }
      } catch (erro) {
        console.error("Erro ao verificar follow:", erro);
      }
    };
    verificarFollow();
  }, [id]);

  const alternarFollow = async () => {
    const user = auth.currentUser;
    if (!user) {
      alert("Inicie sessão para seguir utilizadores.");
      return;
    }

    try {
      const userRef = doc(db, 'users', user.uid);
      
      if (seguindo) {
        // Deixar de seguir
        await updateDoc(userRef, {
          seguindo: arrayRemove(id)
        });
        setSeguindo(false);
      } else {
        // Seguir (cria o documento se não existir)
        await setDoc(userRef, {
          seguindo: arrayUnion(id)
        }, { merge: true });
        setSeguindo(true);
      }
    } catch (erro) {
      console.error("Erro ao seguir:", erro);
    }
  };

  useEffect(() => {
    const carregarPerfilAmigo = async () => {
      try {
        // Busca APENAS os treinos onde o userId é igual ao ID da URL
        const q = query(collection(db, 'workouts'), where('userId', '==', id));
        const snapshot = await getDocs(q);

        let volumeCalc = 0;
        let nomeAmigo = 'Atleta';
        let fotoAmigo = '';

        const treinosRealizados = snapshot.docs.map(doc => {
          const dados = doc.data();
          
          // "Pega emprestado" o nome e foto do amigo a partir do primeiro treino que encontrarmos
          if (dados.userName) nomeAmigo = dados.userName;
          if (dados.userPhoto) fotoAmigo = dados.userPhoto;

          let volumeTreino = 0;
          if (dados.exerciciosRealizados) {
            dados.exerciciosRealizados.forEach(ex => {
              if (ex.series) {
                ex.series.forEach(serie => {
                  if (serie.concluida && serie.peso && serie.reps) {
                    volumeTreino += (Number(serie.peso) * Number(serie.reps));
                  }
                });
              }
            });
          }
          
          volumeCalc += volumeTreino;
          return { id: doc.id, ...dados, volume: volumeTreino };
        });

        // Ordena por data (mais recente primeiro)
        treinosRealizados.sort((a, b) => b.data.seconds - a.data.seconds);

        setHistorico(treinosRealizados);
        setEstatisticas({ totalTreinos: treinosRealizados.length, volumeTotal: volumeCalc });
        setDadosAmigo({ nome: nomeAmigo, foto: fotoAmigo });

      } catch (erro) {
        console.error("Erro ao carregar perfil do amigo:", erro);
      } finally {
        setCarregando(false);
      }
    };

    carregarPerfilAmigo();
  }, [id]);

  if (carregando) return <p style={{ color: 'white', padding: '20px' }}>Carregando perfil...</p>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '30px' }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'white', fontSize: '24px', cursor: 'pointer' }}>←</button>
        
        {dadosAmigo.foto ? (
          <img src={dadosAmigo.foto} alt="Perfil" style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '80px', height: '80px', backgroundColor: '#333', borderRadius: '50%' }}></div>
        )}
        
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>{dadosAmigo.nome}</h1>
          <p style={{ color: '#8e8e93', margin: 0 }}>Atleta da Comunidade</p>
        </div>

        <div>
          <h1 className="page-title" style={{ margin: 0 }}>{dadosAmigo.nome}</h1>
          <p style={{ color: '#8e8e93', margin: 0, marginBottom: '10px' }}>Atleta da Comunidade</p>
          
          {/* Esconde o botão se estiver a ver o seu próprio perfil pelo link de outro */}
          {auth.currentUser && auth.currentUser.uid !== id && (
            <button 
              onClick={alternarFollow}
              style={{ 
                backgroundColor: seguindo ? 'transparent' : '#1a73e8', 
                color: seguindo ? '#8e8e93' : 'white', 
                border: seguindo ? '1px solid #8e8e93' : 'none', 
                padding: '8px 20px', 
                borderRadius: '20px', 
                fontWeight: 'bold', 
                cursor: 'pointer' 
              }}
            >
              {seguindo ? 'A Seguir' : 'Seguir'}
            </button>
          )}
        </div>

      </div>

      <div style={{ backgroundColor: '#1c1c1e', padding: '20px', borderRadius: '12px', marginBottom: '30px', display: 'flex', gap: '40px' }}>
        <div>
          <p style={{ color: '#8e8e93', fontSize: '14px', marginBottom: '5px' }}>Workouts</p>
          <h2 style={{ margin: 0 }}>{estatisticas.totalTreinos}</h2>
        </div>
        <div>
          <p style={{ color: '#8e8e93', fontSize: '14px', marginBottom: '5px' }}>Volume Total</p>
          <h2 style={{ margin: 0 }}>{estatisticas.volumeTotal} kg</h2>
        </div>
      </div>

      <h3 style={{ marginBottom: '20px' }}>Atividade Recente</h3>

      <div className="routines-list">
        {historico.length === 0 ? (
          <p style={{ color: 'gray' }}>Este utilizador não tem treinos finalizados.</p>
        ) : (
          historico.map(treino => (
            <div key={treino.id} style={{ backgroundColor: '#1c1c1e', padding: '20px', borderRadius: '12px', marginBottom: '15px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                <h3 style={{ margin: 0, color: '#1a73e8' }}>{treino.nome}</h3>
                <span style={{ color: '#8e8e93', fontSize: '14px' }}>
                  {treino.data ? new Date(treino.data.seconds * 1000).toLocaleDateString() : ''}
                </span>
              </div>
              <p style={{ color: '#8e8e93', fontSize: '14px', marginBottom: '15px' }}>Volume: <strong style={{ color: 'white' }}>{treino.volume} kg</strong></p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RoutineDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [rotina, setRotina] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [mostrandoCatalogo, setMostrandoCatalogo] = useState(false);

  const [catalogoFirebase, setCatalogoFirebase] = useState([]);

  useEffect(() => {
    const buscarRotina = async () => {
      try {
        const docRef = doc(db, 'routines', id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const dados = docSnap.data();
          // Garante que o array existe para evitar erros
          if (!dados.exerciciosDetalhados) dados.exerciciosDetalhados = [];
          setRotina(dados);
        }
      } catch (erro) {
        console.error("Erro ao buscar detalhes:", erro);
      } finally {
        setCarregando(false);
      }
    };
    buscarRotina();
  }, [id]);

  // Busca a lista de exercícios disponíveis no banco de dados
  useEffect(() => {
    const buscarCatalogo = async () => {
      const user = auth.currentUser;
      if (!user) return;

      const q = query(collection(db, 'exercises'), where('userId', '==', user.uid));
      const snapshot = await getDocs(q);

      const exercicios = snapshot.docs.map(doc => ({
        id: doc.id,
        nome: doc.data().nome
      }));

      setCatalogoFirebase(exercicios);
    };
    buscarCatalogo();
  }, []);

  // Função para adicionar um exercício à rotina
  const adicionarExercicio = (exercicio) => {
    const novoExercicio = {
      id: exercicio.id,
      nome: exercicio.nome,
      series: [] // Começa sem séries
    };

    setRotina(prev => ({
      ...prev,
      exerciciosDetalhados: [...prev.exerciciosDetalhados, novoExercicio]
    }));

    setMostrandoCatalogo(false);
  };

  // --- NOVAS FUNÇÕES PARA AS SÉRIES ---

  const adicionarSerie = (exercicioIndex) => {
    const novaRotina = { ...rotina };
    const exercicio = novaRotina.exerciciosDetalhados[exercicioIndex];

    // Adiciona uma nova série vazia
    exercicio.series.push({ peso: '', reps: '' });
    setRotina(novaRotina);
  };

  const removerSerie = (exIndex, serieIndex) => {
    const novaRotina = { ...rotina };
    // Acede ao exercício específico e remove 1 elemento a partir da posição serieIndex
    novaRotina.exerciciosDetalhados[exIndex].series.splice(serieIndex, 1);
    setRotina(novaRotina);
  };

  const removerExercicioDaRotina = (exIndex) => {
    if (!window.confirm("Remover este exercício da rotina?")) return;

    const novaRotina = { ...rotina };
    // O .splice remove 1 item do array a partir da posição exIndex
    novaRotina.exerciciosDetalhados.splice(exIndex, 1);

    setRotina(novaRotina);
  };

  const atualizarSerie = (exercicioIndex, serieIndex, campo, valor) => {
    const novaRotina = { ...rotina };
    // Atualiza o peso ou as reps daquela série específica
    novaRotina.exerciciosDetalhados[exercicioIndex].series[serieIndex][campo] = valor;
    setRotina(novaRotina);
  };

  const guardarRotinaNoFirebase = async () => {
    try {
      const docRef = doc(db, 'routines', id);

      // Agora salvamos tanto o array de exercícios quanto o nome da rotina
      await updateDoc(docRef, {
        nome: rotina.nome,
        exerciciosDetalhados: rotina.exerciciosDetalhados
      });

      alert('Rotina guardada com sucesso!');
    } catch (erro) {
      console.error("Erro ao guardar rotina:", erro);
      alert('Erro ao guardar a rotina.');
    }
  };

  if (carregando) return <p style={{ color: 'white', padding: '20px' }}>A carregar rotina...</p>;
  if (!rotina) return <p style={{ color: 'white', padding: '20px' }}>Rotina não encontrada.</p>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flex: 1 }}>
          <button onClick={() => navigate('/routines')} style={{ background: 'none', border: 'none', color: 'white', fontSize: '24px', cursor: 'pointer' }}>←</button>

          {/* O Título agora é um Input editável */}
          <input
            type="text"
            value={rotina.nome}
            onChange={(e) => setRotina({ ...rotina, nome: e.target.value })}
            style={{
              fontSize: '28px',
              fontWeight: 'bold',
              backgroundColor: 'transparent',
              color: 'white',
              border: 'none',
              borderBottom: '1px dashed #333',
              outline: 'none',
              width: '100%',
              fontFamily: 'inherit'
            }}
          />
        </div>

        {/* Novo botão para guardar as alterações */}
        <button onClick={guardarRotinaNoFirebase} style={{ backgroundColor: '#4CAF50', color: 'white', border: 'none', padding: '10px 15px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
          Guardar Rotina
        </button>
        <button onClick={() => navigate(`/workout/${id}`)} style={{ backgroundColor: '#1a73e8', color: 'white', border: 'none', padding: '10px 15px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
          Iniciar Treino
        </button>
      </div>

      <div className="routines-container">

        <div className="routines-list">
          {rotina.exerciciosDetalhados && rotina.exerciciosDetalhados.length > 0 ? (
            rotina.exerciciosDetalhados.map((ex, exIndex) => (
              <div key={exIndex} style={{ backgroundColor: '#1c1c1e', padding: '20px', borderRadius: '12px', marginBottom: '15px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                  <h3 style={{ fontSize: '18px', margin: 0 }}>{ex.nome}</h3>
                  <button
                    onClick={() => removerExercicioDaRotina(exIndex)}
                    style={{ background: 'none', border: 'none', color: '#ff4d4d', cursor: 'pointer', fontSize: '14px' }}
                  >
                    Remover Exercício
                  </button>
                </div>

                {/* Cabeçalho das Séries */}
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#8e8e93', fontSize: '12px', marginBottom: '10px', padding: '0 10px' }}>
                  <span style={{ width: '30px' }}>SET</span>
                  <span style={{ width: '60px', textAlign: 'center' }}>KG</span>
                  <span style={{ width: '60px', textAlign: 'center' }}>REPS</span>
                </div>

                {/* Lista de Séries */}
                {/* Lista de Séries */}
                {ex.series && ex.series.map((serie, serieIndex) => (
                  <div key={serieIndex} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', backgroundColor: '#2c2c2e', padding: '10px', borderRadius: '8px' }}>
                    <span style={{ width: '30px', fontWeight: 'bold' }}>{serieIndex + 1}</span>
                    <input
                      type="number"
                      placeholder="-"
                      value={serie.peso}
                      onChange={(e) => atualizarSerie(exIndex, serieIndex, 'peso', e.target.value)}
                      style={{ width: '60px', backgroundColor: 'transparent', border: 'none', color: 'white', textAlign: 'center', fontSize: '16px', outline: 'none' }}
                    />
                    <input
                      type="number"
                      placeholder="-"
                      value={serie.reps}
                      onChange={(e) => atualizarSerie(exIndex, serieIndex, 'reps', e.target.value)}
                      style={{ width: '60px', backgroundColor: 'transparent', border: 'none', color: 'white', textAlign: 'center', fontSize: '16px', outline: 'none' }}
                    />

                    {/* NOVO BOTÃO: Remover Série */}
                    <button
                      onClick={() => removerSerie(exIndex, serieIndex)}
                      style={{ background: 'none', border: 'none', color: '#ff4d4d', fontWeight: 'bold', cursor: 'pointer', padding: '0 10px', fontSize: '16px' }}
                      title="Eliminar esta série"
                    >
                      X
                    </button>
                  </div>
                ))}

                <button
                  onClick={() => adicionarSerie(exIndex)}
                  style={{ marginTop: '10px', width: '100%', padding: '10px', backgroundColor: 'transparent', color: '#1a73e8', border: '1px solid #1a73e8', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  + Add Set
                </button>
              </div>
            ))
          ) : (
            <p style={{ color: 'gray' }}>Nenhum exercício adicionado ainda.</p>
          )}
        </div>

        <div className="routines-actions">
          <button
            className="btn-primary"
            onClick={() => setMostrandoCatalogo(!mostrandoCatalogo)}
            style={{ marginBottom: '15px' }}
          >
            {mostrandoCatalogo ? 'Cancelar' : '+ Adicionar Exercício'}
          </button>

          {mostrandoCatalogo && (
            <div style={{ backgroundColor: '#1c1c1e', borderRadius: '12px', padding: '10px' }}>
              <p style={{ color: 'gray', fontSize: '12px', padding: '5px 10px' }}>Escolha um exercício:</p>
              {catalogoFirebase.length === 0 ? (
                <p style={{ color: 'gray', padding: '10px' }}>Vá na aba "Exercises" e cadastre seus exercícios primeiro.</p>
              ) : (
                catalogoFirebase.map(ex => (
                  <div
                    key={ex.id}
                    onClick={() => adicionarExercicio(ex)}
                    style={{ padding: '15px 10px', borderBottom: '1px solid #2c2c2e', cursor: 'pointer', color: 'white' }}
                  >
                    {ex.nome}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function ActiveWorkout() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [treinoAtivo, setTreinoAtivo] = useState(null);
  const [tempo, setTempo] = useState(0); // Simulando um cronômetro 
  
  // Estado para rastrear a suplementação e otimização do treino
  const [combustivel, setCombustivel] = useState({
    preTreino: '',
    posTreino: '',
    nivelEnergia: 3, // Escala de 1 a 5
    qualidadeSono: 3 // Escala de 1 a 5
  });

  // 1. Carrega a rotina para servir de base para o treino
  useEffect(() => {
    const carregarTreino = async () => {
      const docRef = doc(db, 'routines', id);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const dados = docSnap.data();

        // Injeta a propriedade "concluida: false" em todas as séries para o controle da tela
        const exerciciosPreparados = (dados.exerciciosDetalhados || []).map(ex => ({
          ...ex,
          series: (ex.series || []).map(serie => ({ ...serie, concluida: false }))
        }));

        setTreinoAtivo({ ...dados, exerciciosDetalhados: exerciciosPreparados });
      }
    };
    carregarTreino();
  }, [id]);

  // 2. Função para marcar a série como feita (o "check" verde)
  const alternarConclusao = (exIndex, serieIndex) => {
    const novoTreino = { ...treinoAtivo };
    const serie = novoTreino.exerciciosDetalhados[exIndex].series[serieIndex];
    serie.concluida = !serie.concluida;
    setTreinoAtivo(novoTreino);
  };

  // 3. Atualizar KG e Reps durante o treino (caso você faça mais ou menos do que planejou)
  const atualizarValorReal = (exIndex, serieIndex, campo, valor) => {
    const novoTreino = { ...treinoAtivo };
    novoTreino.exerciciosDetalhados[exIndex].series[serieIndex][campo] = valor;
    setTreinoAtivo(novoTreino);
  };

  // 4. Finalizar e salvar no Histórico (Coleção 'workouts')
  const finalizarTreino = async () => {
    try {
      const user = auth.currentUser;
      const workoutsRef = collection(db, 'workouts');
      
      // --- INÍCIO DO ALGORITMO DE RECORDES (PR) ---
      const novosRecordes = []; // Array para guardar os nomes dos exercícios com novo PR

      for (const ex of treinoAtivo.exerciciosDetalhados) {
        let maxPesoNesteTreino = 0;

        // Acha a série mais pesada deste exercício no treino atual
        if (ex.series) {
          ex.series.forEach(serie => {
            if (serie.concluida && Number(serie.peso) > maxPesoNesteTreino) {
              maxPesoNesteTreino = Number(serie.peso);
            }
          });
        }

        // Se levantou algum peso, vamos comparar com o banco de dados
        if (maxPesoNesteTreino > 0) {
          // Criamos um ID único juntando o seu ID com o ID do Exercício (ex: "uid123_supino")
          const prRef = doc(db, 'personal_records', `${user.uid}_${ex.id}`);
          const prSnap = await getDoc(prRef);

          // Se o recorde não existe ainda, OU se o peso de hoje é maior que o antigo: Bateu PR!
          if (!prSnap.exists() || prSnap.data().pesoMaximo < maxPesoNesteTreino) {
            
            await setDoc(prRef, {
              pesoMaximo: maxPesoNesteTreino,
              data: new Date()
            });

            novosRecordes.push(ex.nome); // Guarda o nome para mostrar no Feed
          }
        }
      }
      // --- FIM DO ALGORITMO ---

      // Salva o registro final no Firebase
      await addDoc(workoutsRef, {
        userId: user.uid,
        userName: user.displayName || 'Atleta Anônimo',
        userPhoto: user.photoURL || '',
        rotinaOrigemId: id,
        nome: treinoAtivo.nome,
        data: new Date(),
        exerciciosRealizados: treinoAtivo.exerciciosDetalhados,
        duracaoSegundos: tempo,
        otimizacao: combustivel,
        recordesQuebrados: novosRecordes // <-- NOVO: Salvando a lista de recordes quebrados!
      });

      alert("Treino finalizado! 💪");
      navigate('/'); 
    } catch (erro) {
      console.error("Erro ao salvar o treino:", erro);
      alert("Erro ao finalizar o treino.");
    }
  };

  const removerSerie = (exIndex, serieIndex) => {
    const novaRotina = { ...rotina };
    // Acede ao exercício específico e remove 1 elemento a partir da posição serieIndex
    novaRotina.exerciciosDetalhados[exIndex].series.splice(serieIndex, 1);
    setRotina(novaRotina);
  };

  if (!treinoAtivo) return <p style={{ color: 'white', padding: '20px' }}>Preparando os pesos...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <p style={{ color: '#8e8e93', margin: 0 }}>Treino em andamento</p>
          <h1 className="page-title" style={{ margin: 0, color: '#1a73e8' }}>{treinoAtivo.nome}</h1>
        </div>

        <button onClick={finalizarTreino} style={{ backgroundColor: '#4CAF50', color: 'white', border: 'none', padding: '15px 20px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
          Finalizar
        </button>
      </div>

      <div className="routines-list">
        {treinoAtivo.exerciciosDetalhados.map((ex, exIndex) => (
          <div key={exIndex} style={{ backgroundColor: '#1c1c1e', padding: '20px', borderRadius: '12px', marginBottom: '15px' }}>
            <h3 style={{ fontSize: '18px', marginBottom: '15px' }}>{ex.nome}</h3>

            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#8e8e93', fontSize: '12px', marginBottom: '10px', padding: '0 10px' }}>
              <span style={{ width: '30px' }}>SET</span>
              <span style={{ width: '60px', textAlign: 'center' }}>KG</span>
              <span style={{ width: '60px', textAlign: 'center' }}>REPS</span>
              <span style={{ width: '40px', textAlign: 'center' }}>✓</span>
            </div>

            {ex.series.map((serie, serieIndex) => (
              <div key={serieIndex} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px',
                backgroundColor: serie.concluida ? '#2e4c30' : '#2c2c2e', // Fica verde escuro se concluído
                padding: '10px', borderRadius: '8px',
                transition: 'background-color 0.3s'
              }}>
                <span style={{ width: '30px', fontWeight: 'bold' }}>{serieIndex + 1}</span>

                <input
                  type="number"
                  value={serie.peso}
                  onChange={(e) => atualizarValorReal(exIndex, serieIndex, 'peso', e.target.value)}
                  style={{ width: '60px', backgroundColor: 'rgba(0,0,0,0.2)', border: 'none', color: 'white', textAlign: 'center', fontSize: '16px', borderRadius: '4px', padding: '5px' }}
                />

                <input
                  type="number"
                  value={serie.reps}
                  onChange={(e) => atualizarValorReal(exIndex, serieIndex, 'reps', e.target.value)}
                  style={{ width: '60px', backgroundColor: 'rgba(0,0,0,0.2)', border: 'none', color: 'white', textAlign: 'center', fontSize: '16px', borderRadius: '4px', padding: '5px' }}
                />

                <button
                  onClick={() => alternarConclusao(exIndex, serieIndex)}
                  style={{
                    width: '40px', height: '30px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold',
                    backgroundColor: serie.concluida ? '#4CAF50' : '#4a4a4c',
                    color: 'white'
                  }}
                >
                  {serie.concluida ? '✓' : ''}
                </button>
                {/* NOVO BOTÃO DE REMOVER NO TREINO ATIVO */}
                <button
                  onClick={() => removerSerie(exIndex, serieIndex)}
                  style={{ background: 'none', border: 'none', color: '#ff4d4d', fontWeight: 'bold', cursor: 'pointer', marginLeft: '10px' }}
                >
                  X
                </button>
              </div>
            ))}
          </div>
        ))}

        

      </div>

      {/* --- MÓDULO DE OTIMIZAÇÃO (COMBUSTÍVEL) --- */}
      <div style={{ backgroundColor: '#121212', padding: '20px', borderRadius: '12px', marginTop: '30px', border: '1px solid #2c2c2e' }}>
        <h3 style={{ margin: '0 0 15px 0', color: '#1a73e8' }}>⚡ Otimização de Performance</h3>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          
          {/* Inputs de Suplementação */}
          <div style={{ display: 'flex', gap: '10px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '12px', color: '#8e8e93', display: 'block', marginBottom: '5px' }}>Pré-Treino (Fórmula/Dose)</label>
              <input 
                type="text" 
                placeholder="Ex: Fórmula Custom 10g"
                value={combustivel.preTreino}
                onChange={(e) => setCombustivel({...combustivel, preTreino: e.target.value})}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: 'none', backgroundColor: '#2c2c2e', color: 'white', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '12px', color: '#8e8e93', display: 'block', marginBottom: '5px' }}>Pós-Treino (Fórmula/Dose)</label>
              <input 
                type="text" 
                placeholder="Ex: Whey + Creatina"
                value={combustivel.posTreino}
                onChange={(e) => setCombustivel({...combustivel, posTreino: e.target.value})}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: 'none', backgroundColor: '#2c2c2e', color: 'white', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* Sliders de Energia e Sono */}
          <div style={{ display: 'flex', gap: '20px', marginTop: '10px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '12px', color: '#8e8e93', display: 'block', marginBottom: '5px' }}>
                Nível de Energia: <strong style={{color: 'white'}}>{combustivel.nivelEnergia}/5</strong>
              </label>
              <input 
                type="range" min="1" max="5" 
                value={combustivel.nivelEnergia}
                onChange={(e) => setCombustivel({...combustivel, nivelEnergia: Number(e.target.value)})}
                style={{ width: '100%', accentColor: '#1a73e8' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '12px', color: '#8e8e93', display: 'block', marginBottom: '5px' }}>
                Qualidade do Sono: <strong style={{color: 'white'}}>{combustivel.qualidadeSono}/5</strong>
              </label>
              <input 
                type="range" min="1" max="5" 
                value={combustivel.qualidadeSono}
                onChange={(e) => setCombustivel({...combustivel, qualidadeSono: Number(e.target.value)})}
                style={{ width: '100%', accentColor: '#1a73e8' }}
              />
            </div>
          </div>

        </div>
      </div>
      
    </div>
  );
}

// --- ESTRUTURA PRINCIPAL (Menu Lateral + Área de Conteúdo) ---

function App() {
  const [usuario, setUsuario] = useState(null);
  const [carregandoAuth, setCarregandoAuth] = useState(true);

  // O "espião" que verifica se tem alguém logado quando o app abre
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (userLogado) => {
      setUsuario(userLogado);
      setCarregandoAuth(false);
    });

    // Limpa o espião quando o componente for destruído
    return () => unsubscribe();
  }, []);

  // Função para abrir o popup do Google
  const fazerLoginComGoogle = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (erro) {
      console.error("Erro ao fazer login:", erro);
    }
  };

  if (carregandoAuth) {
    return <div style={{ padding: '50px', color: 'white', textAlign: 'center' }}>Carregando aplicativo...</div>;
  }

  // SE NÃO TIVER USUÁRIO: Mostra a tela de Login
  if (!usuario) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#000', color: 'white' }}>
        <h1 style={{ marginBottom: '10px' }}>MeuTreino App</h1>
        <p style={{ color: 'gray', marginBottom: '30px' }}>Faça login para salvar suas rotinas.</p>

        <button
          onClick={fazerLoginComGoogle}
          style={{ backgroundColor: '#fff', color: '#000', border: 'none', padding: '15px 30px', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}
        >
          <span>G</span> Entrar com o Google
        </button>
      </div>
    );
  }

  // SE TIVER USUÁRIO: Mostra o Aplicativo Completo
  return (
    <BrowserRouter>
      <div className="app-container">

        <aside className="sidebar">
          <div className="logo">MeuTreino</div>

          {/* Mostrando o nome do usuário logado e botão de sair */}
          <div style={{ padding: '0 15px', marginBottom: '20px' }}>
            <p style={{ color: 'white', fontSize: '14px', marginBottom: '5px' }}>Olá, {usuario.displayName}</p>
            <button
              onClick={() => signOut(auth)}
              style={{ background: 'none', border: 'none', color: '#e53935', cursor: 'pointer', fontSize: '12px', padding: 0 }}
            >
              Sair da conta
            </button>
          </div>

          <nav>
            <div className="nav-menu">
              <Link to="/" className="nav-item">Feed</Link>
              <Link to="/routines" className="nav-item">Routines</Link>
              <Link to="/exercises" className="nav-item">Exercises</Link>
              <Link to="/profile" className="nav-item">Profile</Link>
            </div>
          </nav>
        </aside>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<Feed />} />
            <Route path="/routines" element={<Routines />} />
            <Route path="/routines/:id" element={<RoutineDetail />} />
            <Route path="/workout/:id" element={<ActiveWorkout />} />
            <Route path="/exercises" element={<Exercises />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/user/:id" element={<UserProfile />} />
          </Routes>
        </main>

      </div>
    </BrowserRouter>
  );
}

export default App;