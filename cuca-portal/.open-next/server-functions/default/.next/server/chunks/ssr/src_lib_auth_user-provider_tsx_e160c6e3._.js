module.exports=[48340,a=>{"use strict";var b=a.i(87924),c=a.i(72131),d=a.i(95445);let e=(0,c.createContext)({user:null,profile:null,loading:!0,hasPermission:()=>!1});function f({children:a}){let[f,g]=(0,c.useState)(null),[h,i]=(0,c.useState)(null),[j,k]=(0,c.useState)(!0),l=(0,d.createClient)(),m=async a=>{let{data:b,error:c}=await l.from("colaboradores").select(`
                id,
                nome_completo,
                unidade_cuca,
                funcoes (
                    nome,
                    funcoes_permissoes (
                        permissoes (
                            recurso,
                            acao
                        )
                    )
                )
            `).eq("user_id",a).single();return c||!b?(console.error("Erro ao carregar perfil:",c),null):{id:b.id,nome_completo:b.nome_completo,unidade_cuca:b.unidade_cuca,funcao:{nome:b.funcoes.nome,permissoes:b.funcoes.funcoes_permissoes.map(a=>({recurso:a.permissoes.recurso,acao:a.permissoes.acao}))}}};return(0,c.useEffect)(()=>{(async()=>{k(!0);let{data:{user:a}}=await l.auth.getUser();g(a),a?i(await m(a.id)):i(null),k(!1)})();let{data:{subscription:a}}=l.auth.onAuthStateChange(async(a,b)=>{let c=b?.user??null;g(c),c?i(await m(c.id)):i(null),k(!1)});return()=>a.unsubscribe()},[l.auth]),(0,b.jsx)(e.Provider,{value:{user:f,profile:h,loading:j,hasPermission:(a,b)=>!!h&&("super_admin"===h.funcao.nome||h.funcao.permissoes.some(c=>c.recurso===a&&(c.acao===b||"*"===c.acao)))},children:a})}a.s(["UserProvider",()=>f,"useUser",0,()=>{let a=(0,c.useContext)(e);if(void 0===a)throw Error("useUser must be used within a UserProvider");return a}])}];

//# sourceMappingURL=src_lib_auth_user-provider_tsx_e160c6e3._.js.map